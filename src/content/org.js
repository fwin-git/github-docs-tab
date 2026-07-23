// Organization-wide docs: remembered repo selection + a cross-repo content
// index built from each repo's (ETag-cached) tree and file contents.
import { ext } from '../common/browser.js';
import { ContentIndex } from '../common/search.js';
import { collectDocs } from '../common/docs-model.js';
import { parseFrontmatter, normalizeTags, docTitle } from '../common/frontmatter.js';
import { mdToPlainText, extractHeadings, bestHeadingTitle } from '../common/md-text.js';
import { makeClient } from './github-api.js';

// Separates repo from path in index keys; NUL never appears in git paths.
export const ORG_SEP = '\u0000';

const selKey = (owner) => `gdt:org:${owner}`;

export async function loadOrgSelection(owner) {
  try {
    return (await ext.storage.local.get(selKey(owner)))[selKey(owner)] ?? null;
  } catch {
    return null;
  }
}

export async function saveOrgSelection(owner, repos) {
  await ext.storage.local.set({ [selKey(owner)]: { repos, savedAt: Date.now() } });
}

export async function buildOrgIndex({ owner, repoNames, settings, onProgress = () => {} }) {
  const index = new ContentIndex();
  const repoDocs = new Map();
  const errors = [];
  let done = 0;
  for (const repo of repoNames) {
    onProgress(`Indexing ${repo}… (${++done}/${repoNames.length})`);
    try {
      const client = makeClient({
        owner,
        repo,
        token: settings.token,
        candidateFolders: settings.docsFolders,
      });
      const treeRes = await client.getTree();
      const { docs } = collectDocs(treeRes.entries, {
        folders: settings.docsFolders,
        includeRootFiles: settings.includeRootFiles,
        maxFiles: settings.maxFiles,
      });
      const limit = (settings.contentSearchLimitKB || 200) * 1024;
      const queue = [...docs];
      const worker = async () => {
        while (queue.length) {
          const doc = queue.shift();
          if (doc.size && doc.size > limit) continue;
          try {
            const source = await client.getRawText(doc.path);
            const { data, content } = parseFrontmatter(source);
            doc.title = docTitle(data, '') || bestHeadingTitle(content) || doc.title;
            index.add(`${repo}${ORG_SEP}${doc.path}`, {
              text: mdToPlainText(content),
              title: doc.title,
              headings: extractHeadings(content),
              tags: normalizeTags(data),
            });
          } catch {
            // unreadable file: skip
          }
        }
      };
      await Promise.all(Array.from({ length: 4 }, worker));
      repoDocs.set(repo, docs);
    } catch (err) {
      errors.push({ repo, message: (err && err.message) || String(err) });
    }
  }
  return { index, repoDocs, errors };
}
