// The docs viewer UI: mounts inside GitHub's <main>, hides the original page
// content (restored on close), and renders sidebar tree / article / TOC /
// search. All remote markdown goes through render-doc.js (DOMPurify).
import {
  buildTree,
  sortTree,
  flattenTree,
  findNode,
  dirIndexDoc,
  displayDocTitle,
} from '../common/docs-model.js';
import { buildResolver } from '../common/wikilinks.js';
import { ContentIndex } from '../common/search.js';
import { normalizeTags, docTitle, parseFrontmatter, isPinned } from '../common/frontmatter.js';
import { resolveRelative, splitAnchor, isMarkdownPath, dirname, basename } from '../common/paths.js';
import { buildHash } from '../common/route.js';
import { githubSlug } from '../common/slugger.js';
import { mdToPlainText, extractHeadings, bestHeadingTitle } from '../common/md-text.js';
import { buildUnifiedPatch } from '../common/diff.js';
import { defaultCommitMessage, branchNameFor, editPageUrl } from '../common/edit-utils.js';
import { ext } from '../common/browser.js';
import { saveSettings } from '../common/settings.js';
import { createMarkdownIt } from './markdown.js';
import { renderDoc } from './render-doc.js';
import { createSearchUI } from './search-ui.js';
import { RateLimitError } from './github-api.js';

const ICONS = {
  chevron:
    '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z"></path></svg>',
  file:
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.011-.013-2.914-2.914-.013-.011Z"></path></svg>',
  folder:
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z"></path></svg>',
  pin:
    '<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M4.456.734a1.75 1.75 0 0 1 2.826.504l.613 1.327a3.081 3.081 0 0 0 2.084 1.707l2.454.584c1.332.317 1.8 1.972.832 2.94L11.06 10l3.72 3.72a.749.749 0 1 1-1.06 1.06L10 11.06l-2.204 2.205c-.968.968-2.623.5-2.94-.832l-.584-2.454a3.081 3.081 0 0 0-1.707-2.084l-1.327-.613a1.75 1.75 0 0 1-.504-2.826L4.456.734ZM5.92 1.866a.25.25 0 0 0-.404-.072L1.794 5.516a.25.25 0 0 0 .072.404l1.328.613A4.582 4.582 0 0 1 5.73 9.63l.584 2.454a.25.25 0 0 0 .42.12l5.47-5.47a.25.25 0 0 0-.12-.42L9.63 5.73a4.581 4.581 0 0 1-3.098-2.537L5.92 1.866Z"></path></svg>',
  heading:
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M3.75 2a.75.75 0 0 1 .75.75V7h7V2.75a.75.75 0 0 1 1.5 0v10.5a.75.75 0 0 1-1.5 0V8.5h-7v4.75a.75.75 0 0 1-1.5 0V2.75A.75.75 0 0 1 3.75 2Z"></path></svg>',
  search:
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215ZM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7Z"></path></svg>',
  refresh:
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834ZM8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5Z"></path></svg>',
  github:
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"></path></svg>',
  edit:
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm.176 4.823L9.75 4.81l-6.286 6.287a.253.253 0 0 0-.064.108l-.558 1.953 1.953-.558a.253.253 0 0 0 .108-.064Zm1.238-3.763a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354Z"></path></svg>',
  theme:
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0Zm0 1.5v13a6.5 6.5 0 0 0 0-13Z"></path></svg>',
  sun:
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 12a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm0-1.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm5.657-8.157a.75.75 0 0 1 0 1.061l-1.061 1.06a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734l1.06-1.06a.75.75 0 0 1 1.06 0Zm-9.193 9.193a.75.75 0 0 1 0 1.06l-1.06 1.061a.75.75 0 1 1-1.061-1.06l1.06-1.061a.75.75 0 0 1 1.061 0ZM8 0a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0V.75A.75.75 0 0 1 8 0ZM3 8a.75.75 0 0 1-.75.75H.75a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 3 8Zm13 0a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 16 8Zm-8 5a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 8 13Zm3.536-1.464a.75.75 0 0 1 1.06 0l1.061 1.06a.75.75 0 0 1-1.06 1.061l-1.061-1.06a.75.75 0 0 1 0-1.061ZM2.343 2.343a.75.75 0 0 1 1.061 0l1.06 1.061a.751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018l-1.06-1.06a.75.75 0 0 1 0-1.06Z"></path></svg>',
  moon:
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M9.598 1.591a.749.749 0 0 1 .785-.175 7.001 7.001 0 1 1-8.967 8.967.75.75 0 0 1 .961-.96 5.5 5.5 0 0 0 7.046-7.046.75.75 0 0 1 .175-.786Zm1.616 1.945a7 7 0 0 1-7.678 7.678 5.499 5.499 0 1 0 7.678-7.678Z"></path></svg>',
  copy:
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"></path><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path></svg>',
  check:
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path></svg>',
  external:
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1Z"></path></svg>',
  menu:
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M1 2.75A.75.75 0 0 1 1.75 2h12.5a.75.75 0 0 1 0 1.5H1.75A.75.75 0 0 1 1 2.75Zm0 5A.75.75 0 0 1 1.75 7h12.5a.75.75 0 0 1 0 1.5H1.75A.75.75 0 0 1 1 7.75ZM1.75 12h12.5a.75.75 0 0 1 0 1.5H1.75a.75.75 0 0 1 0-1.5Z"></path></svg>',
};

export function createViewer({ client, settings, docs, truncated, total, onRequestRefresh }) {
  const docByPath = new Map(docs.map((d) => [d.path, d]));
  const metaByPath = new Map();
  const contentCache = new Map();
  const index = new ContentIndex();
  const tree = buildTree(docs);
  sortTree(tree, new Map());
  let flat = flattenTree(tree);

  let resolver = null;
  let resolverDirty = true;
  let root = null;
  let refs = null;
  let searchUI = null;
  let mounted = false;
  let currentPath = null;
  let loadSeq = 0;
  let origTitle = null;
  let keydownHandler = null;
  let tocObserver = null;
  const expansion = new Set();
  const indexState = { started: false, finished: false, done: 0, total: docs.length };
  let theme = settings.theme || 'auto';
  let titleMode = settings.titleMode === 'filename' ? 'filename' : 'heading';
  let treeFilter = '';
  let editor = null; // { path, original, el, textarea, preview, status, dirty, buttons }

  // ---- markdown context -----------------------------------------------------

  function ensureResolver() {
    if (resolverDirty) {
      resolver = buildResolver(docs, resolverMeta());
      resolverDirty = false;
    }
    return resolver;
  }

  function parseGithubFileUrl(href) {
    let u;
    try {
      u = new URL(href);
    } catch {
      return null;
    }
    const segs = u.pathname.split('/').filter(Boolean);
    if (u.hostname === 'github.com' && segs.length >= 5 && ['blob', 'tree', 'raw'].includes(segs[2])) {
      return {
        owner: segs[0],
        repo: segs[1],
        path: segs.slice(4).map(decodeURIComponent).join('/'),
        anchor: u.hash ? u.hash.slice(1).replace(/^user-content-/, '') : null,
      };
    }
    if (u.hostname === 'raw.githubusercontent.com' && segs.length >= 4) {
      return { owner: segs[0], repo: segs[1], path: segs.slice(3).map(decodeURIComponent).join('/'), anchor: null };
    }
    return null;
  }

  const ctx = {
    resolveWikiLink(raw, from) {
      return ensureResolver().resolve(raw, from ?? currentPath ?? '');
    },
    classifyHref(href, from) {
      if (!href) return null;
      if (href.startsWith('#')) return { type: 'anchor', href, anchor: href.slice(1) };
      if (href.startsWith('//')) return { type: 'external', href: 'https:' + href };
      const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href);
      if (scheme) {
        const s = scheme[1].toLowerCase();
        if (s === 'http' || s === 'https') {
          const gh = parseGithubFileUrl(href);
          if (
            gh &&
            gh.owner.toLowerCase() === client.owner.toLowerCase() &&
            gh.repo.toLowerCase() === client.repo.toLowerCase() &&
            isMarkdownPath(gh.path)
          ) {
            const type = docByPath.has(gh.path) ? 'doc' : 'dyn-doc';
            return { type, path: gh.path, anchor: gh.anchor, href: buildHash({ path: gh.path, heading: gh.anchor }) };
          }
          return { type: 'external', href };
        }
        return { type: 'plain', href };
      }
      const { path: p, anchor } = splitAnchor(href);
      if (!p) return { type: 'anchor', href, anchor };
      const resolved = resolveRelative(from ?? currentPath ?? '', p);
      if (!resolved) return { type: 'plain', href };
      if (isMarkdownPath(resolved)) {
        const type = docByPath.has(resolved) ? 'doc' : 'dyn-doc';
        return { type, path: resolved, anchor, href: buildHash({ path: resolved, heading: anchor }) };
      }
      const node = findNode(tree, resolved);
      if (node && node.isDir) {
        const idx = dirIndexDoc(node);
        if (idx) return { type: 'doc', path: idx.path, anchor, href: buildHash({ path: idx.path, heading: anchor }) };
      }
      return { type: 'repo-file', href: client.blobUrl(resolved) + (anchor ? '#' + anchor : ''), path: resolved };
    },
    imageUrl(src, from) {
      if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) return src;
      const resolved = resolveRelative(from ?? currentPath ?? '', src);
      return resolved ? client.rawUrl(resolved) : src;
    },
  };

  const md = createMarkdownIt(ctx);

  // ---- metadata -------------------------------------------------------------

  // Frontmatter and heading-derived titles are stored separately; which one a
  // label shows depends on the sidebar title mode (toggle in the side head).
  function recordMeta(path, data, headingTitle) {
    const doc = docByPath.get(path);
    const prev = metaByPath.get(path);
    const rec = {
      fmTitle: data ? docTitle(data, '') || null : (prev && prev.fmTitle) ?? null,
      headingTitle: headingTitle !== undefined ? headingTitle : (prev && prev.headingTitle) ?? null,
      tags: data ? normalizeTags(data) : (prev && prev.tags) ?? [],
      order: data && typeof data.order === 'number' ? data.order : prev && prev.order,
      sidebar_position:
        data && typeof data.sidebar_position === 'number' ? data.sidebar_position : prev && prev.sidebar_position,
      pinned: data ? isPinned(data) : (prev && prev.pinned) ?? false,
      data: data ?? (prev && prev.data) ?? null,
    };
    metaByPath.set(path, rec);
    resolverDirty = true;
    return displayTitleOf(rec, doc) !== (prev ? displayTitleOf(prev, doc) : doc && doc.title);
  }

  function displayTitleOf(rec, doc) {
    return displayDocTitle(
      {
        fmTitle: rec ? rec.fmTitle : null,
        headingTitle: rec ? rec.headingTitle : null,
        fallback: doc ? doc.title : null,
      },
      titleMode
    );
  }

  function displayTitle(path) {
    return displayTitleOf(metaByPath.get(path), docByPath.get(path)) || basename(path);
  }

  // Mode-aware view for sorting, tree labels, and search result titles.
  function displayMeta() {
    const m = new Map();
    for (const [path, rec] of metaByPath) {
      m.set(path, { ...rec, title: displayTitleOf(rec, docByPath.get(path)) || undefined });
    }
    return m;
  }

  // Mode-independent titles for wiki-link resolution: both declared and
  // heading titles should resolve regardless of the display toggle.
  function resolverMeta() {
    const m = new Map();
    for (const [path, rec] of metaByPath) {
      const t = rec.fmTitle || rec.headingTitle;
      if (t) m.set(path, { title: t });
    }
    return m;
  }

  // ---- DOM scaffold ---------------------------------------------------------

  function h(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function buildDom() {
    root = h(`
      <div id="gdt-root" data-gdt-theme="${theme}">
        <div class="gdt-shell">
          <aside class="gdt-sidebar" data-gdt-sidebar>
            <div class="gdt-side-head">
              <span class="gdt-doc-count" data-gdt-count-label></span>
              <span class="gdt-side-actions">
                <button class="gdt-iconbtn" data-gdt-title-toggle type="button"></button>
                <button class="gdt-iconbtn" data-gdt-refresh type="button" title="Refresh docs list">${ICONS.refresh}</button>
              </span>
            </div>
            <div class="gdt-truncated" data-gdt-truncated hidden></div>
            <input class="gdt-filter-input" data-gdt-filter type="search" placeholder="Filter files…" autocomplete="off" spellcheck="false" aria-label="Filter file tree" />
            <div class="gdt-tags" data-gdt-tags hidden></div>
            <div class="gdt-pinned" data-gdt-pinned hidden>
              <div class="gdt-pinned-title">${ICONS.pin} Pinned</div>
              <div class="gdt-pinned-list" data-gdt-pinned-list></div>
            </div>
            <nav class="gdt-tree" data-gdt-tree aria-label="Documentation files"></nav>
            <div class="gdt-side-foot" data-gdt-progress hidden aria-live="polite"></div>
          </aside>
          <div class="gdt-main">
            <header class="gdt-topbar">
              <button class="gdt-iconbtn gdt-side-toggle" data-gdt-side-toggle type="button" title="Toggle sidebar">${ICONS.menu}</button>
              <nav class="gdt-breadcrumbs" data-gdt-crumbs aria-label="Breadcrumb"></nav>
              <div class="gdt-searchbox">
                <span class="gdt-search-icon">${ICONS.search}</span>
                <input class="gdt-search-input" data-gdt-search type="search" placeholder="Search docs…  ( / )" autocomplete="off" spellcheck="false" />
                <div class="gdt-search-results" data-gdt-results hidden></div>
              </div>
              <div class="gdt-actions">
                <button class="gdt-iconbtn" data-gdt-copy-md type="button" title="Copy document markdown" disabled>${ICONS.copy}</button>
                <button class="gdt-iconbtn" data-gdt-live-edit type="button" title="Edit this document in the viewer" disabled>${ICONS.edit}</button>
                <button class="gdt-iconbtn" data-gdt-theme-toggle type="button" title="Theme: auto">${ICONS.theme}</button>
                <a class="gdt-iconbtn" data-gdt-open-gh target="_blank" rel="noopener noreferrer" title="View on GitHub">${ICONS.github}</a>
                <a class="gdt-iconbtn" data-gdt-edit-gh target="_blank" rel="noopener noreferrer" title="Edit on GitHub (opens github.com editor)">${ICONS.external}</a>
              </div>
            </header>
            <div class="gdt-body">
              <article class="gdt-article" data-gdt-article></article>
              <aside class="gdt-toc" data-gdt-toc hidden aria-label="On this page"></aside>
            </div>
          </div>
        </div>
      </div>
    `);
    refs = {
      sidebar: root.querySelector('[data-gdt-sidebar]'),
      countLabel: root.querySelector('[data-gdt-count-label]'),
      truncatedBox: root.querySelector('[data-gdt-truncated]'),
      filter: root.querySelector('[data-gdt-filter]'),
      tags: root.querySelector('[data-gdt-tags]'),
      pinned: root.querySelector('[data-gdt-pinned]'),
      pinnedList: root.querySelector('[data-gdt-pinned-list]'),
      tree: root.querySelector('[data-gdt-tree]'),
      progress: root.querySelector('[data-gdt-progress]'),
      titleToggle: root.querySelector('[data-gdt-title-toggle]'),
      liveEdit: root.querySelector('[data-gdt-live-edit]'),
      copyMd: root.querySelector('[data-gdt-copy-md]'),
      crumbs: root.querySelector('[data-gdt-crumbs]'),
      searchInput: root.querySelector('[data-gdt-search]'),
      results: root.querySelector('[data-gdt-results]'),
      article: root.querySelector('[data-gdt-article]'),
      toc: root.querySelector('[data-gdt-toc]'),
      themeToggle: root.querySelector('[data-gdt-theme-toggle]'),
      openGh: root.querySelector('[data-gdt-open-gh]'),
      editGh: root.querySelector('[data-gdt-edit-gh]'),
    };

    searchUI = createSearchUI({
      input: refs.searchInput,
      panel: refs.results,
      getDocs: () => docs,
      getMeta: () => displayMeta(),
      getIndex: () => index,
      getIndexState: () => indexState,
      onNavigate: ({ path, heading }) => {
        location.hash = buildHash({ path, heading });
      },
    });

    root.querySelector('[data-gdt-refresh]').addEventListener('click', () => {
      if (onRequestRefresh) onRequestRefresh();
    });
    updateTitleToggle();
    refs.titleToggle.addEventListener('click', () => {
      titleMode = titleMode === 'heading' ? 'filename' : 'heading';
      saveSettings({ titleMode }).catch(() => {});
      updateTitleToggle();
      sortTree(tree, displayMeta());
      flat = flattenTree(tree);
      renderTree();
      if (currentPath) {
        renderCrumbs(currentPath);
        renderPrevNext();
        document.title = `${displayTitle(currentPath)} · Docs · ${client.owner}/${client.repo}`;
      }
    });
    root.querySelector('[data-gdt-side-toggle]').addEventListener('click', () => {
      root.classList.toggle('gdt-side-open');
    });
    refs.themeToggle.addEventListener('click', cycleTheme);
    refs.liveEdit.addEventListener('click', () => {
      if (currentPath) openEditor(currentPath);
    });
    refs.copyMd.addEventListener('click', async () => {
      if (!currentPath) return;
      let source = contentCache.get(currentPath);
      if (source == null) {
        try {
          source = await client.getRawText(currentPath);
          contentCache.set(currentPath, source);
        } catch {
          return;
        }
      }
      const fallbackCopy = () => {
        try {
          const ta = document.createElement('textarea');
          ta.value = source;
          ta.style.cssText = 'position:fixed;opacity:0';
          document.body.appendChild(ta);
          ta.select();
          const ok = document.execCommand('copy');
          ta.remove();
          return ok;
        } catch {
          return false;
        }
      };
      const done = (ok) => {
        refs.copyMd.innerHTML = ok ? ICONS.check : ICONS.copy;
        refs.copyMd.title = ok ? 'Copied!' : 'Clipboard unavailable';
        setTimeout(() => {
          refs.copyMd.innerHTML = ICONS.copy;
          refs.copyMd.title = 'Copy document markdown';
        }, 1400);
      };
      navigator.clipboard.writeText(source).then(
        () => done(true),
        () => done(fallbackCopy())
      );
    });

    let filterTimer = 0;
    refs.filter.addEventListener('input', () => {
      clearTimeout(filterTimer);
      filterTimer = setTimeout(() => {
        treeFilter = refs.filter.value.trim().toLowerCase();
        renderTree();
      }, 100);
    });
    refs.filter.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && refs.filter.value) {
        e.stopPropagation();
        refs.filter.value = '';
        treeFilter = '';
        renderTree();
      }
    });

    root.addEventListener('click', onRootClick);
  }

  function onRootClick(e) {
    const a = e.target.closest('a');
    if (!a || !root.contains(a)) return;
    if (a.classList.contains('gdt-wikilink-broken')) {
      e.preventDefault();
      const target = a.getAttribute('data-gdt-target') || '';
      searchUI.setQuery(target);
      return;
    }
    const href = a.getAttribute('href') || '';
    if (a.hasAttribute('data-gdt-heading')) {
      e.preventDefault();
      scrollToHeading(a.getAttribute('data-gdt-heading'));
      return;
    }
    if (href.startsWith('#') && !href.startsWith('#docs')) {
      // footnote refs and other in-article fragment links
      e.preventDefault();
      scrollToHeading(href.slice(1));
    }
  }

  // Copy buttons via delegation (buttons are re-created on every render).
  function onArticleClick(e) {
    const btn = e.target.closest('[data-gdt-copy]');
    if (!btn) return;
    const pre = btn.parentElement && btn.parentElement.querySelector('pre');
    if (!pre) return;
    navigator.clipboard
      .writeText(pre.textContent)
      .then(() => {
        btn.classList.add('gdt-copied');
        setTimeout(() => btn.classList.remove('gdt-copied'), 1200);
      })
      .catch(() => {});
  }

  // ---- mount / unmount ------------------------------------------------------

  let hiddenMain = null;

  function mount() {
    const main = document.querySelector('main');
    if (!main) return false;
    hiddenMain = main;
    for (const child of [...main.children]) {
      if (child.id !== 'gdt-root') child.setAttribute('data-gdt-hidden', '');
    }
    main.appendChild(root);
    mounted = true;
    origTitle = document.title;
    refs.article.addEventListener('click', onArticleClick);
    keydownHandler = (e) => {
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const t = e.target;
        const typing =
          t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
        if (!typing) {
          e.preventDefault();
          searchUI.focus();
        }
      }
    };
    document.addEventListener('keydown', keydownHandler, true);
    updateSidebarMeta();
    renderTree();
    refs.openGh.href = `https://github.com/${client.owner}/${client.repo}`;
    return true;
  }

  function close() {
    if (!mounted) return;
    if (editor) closeEditor(true);
    mounted = false;
    document.removeEventListener('keydown', keydownHandler, true);
    if (tocObserver) {
      tocObserver.disconnect();
      tocObserver = null;
    }
    root.remove();
    document.querySelectorAll('[data-gdt-hidden]').forEach((el) => el.removeAttribute('data-gdt-hidden'));
    if (origTitle != null) document.title = origTitle;
    currentPath = null;
    hiddenMain = null;
  }

  // ---- theme ----------------------------------------------------------------

  function applyTheme() {
    root.setAttribute('data-gdt-theme', theme);
    const next = theme === 'auto' ? 'light' : theme === 'light' ? 'dark' : 'auto';
    refs.themeToggle.innerHTML = theme === 'auto' ? ICONS.theme : theme === 'light' ? ICONS.sun : ICONS.moon;
    refs.themeToggle.title =
      theme === 'auto' ? `Theme: auto (follows GitHub) — click for light` : `Theme: ${theme} — click for ${next}`;
  }

  function updateTitleToggle() {
    refs.titleToggle.innerHTML = titleMode === 'heading' ? ICONS.heading : ICONS.file;
    refs.titleToggle.title =
      titleMode === 'heading'
        ? 'Sidebar titles: document titles (frontmatter title, else first headline) — click for filenames'
        : 'Sidebar titles: filenames — click for document titles';
  }

  function cycleTheme() {
    theme = theme === 'auto' ? 'light' : theme === 'light' ? 'dark' : 'auto';
    applyTheme();
    saveSettings({ theme }).catch(() => {});
  }

  // ---- sidebar --------------------------------------------------------------

  function updateSidebarMeta() {
    refs.countLabel.textContent = `${total} document${total === 1 ? '' : 's'}`;
    if (truncated) {
      refs.truncatedBox.hidden = false;
      refs.truncatedBox.textContent = `Showing the first ${docs.length} of ${total} docs (raise the limit in Options).`;
    }
  }

  function docLabel(child) {
    return displayTitleOf(metaByPath.get(child.path), child.doc) || child.doc.title;
  }

  function matchesFilter(child) {
    if (!treeFilter) return true;
    const hay = `${docLabel(child)} ${child.path}`.toLowerCase();
    return treeFilter.split(/\s+/).every((tok) => hay.includes(tok));
  }

  function renderTree() {
    const treeEl = refs.tree;
    treeEl.textContent = '';
    const list = renderNodes(tree, 0);
    if (treeFilter && !list.querySelector('a')) {
      const empty = document.createElement('div');
      empty.className = 'gdt-tree-empty';
      empty.textContent = 'No files match the filter';
      treeEl.appendChild(empty);
    } else {
      treeEl.appendChild(list);
    }
    renderPinned();
    markSelection();
  }

  function renderNodes(node, depth) {
    const ul = document.createElement('ul');
    ul.className = 'gdt-tree-list';
    for (const child of node.children) {
      const li = document.createElement('li');
      if (child.isDir) {
        const sub = renderNodes(child, depth + 1);
        if (treeFilter && !sub.querySelector('a')) continue; // no matching descendants
        const open = treeFilter ? true : expansion.has(child.path) || depth < 1;
        if (open && !treeFilter) expansion.add(child.path);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'gdt-dir' + (open ? ' gdt-open' : '');
        btn.innerHTML = `<span class="gdt-chevron">${ICONS.chevron}</span><span class="gdt-folder-ico">${ICONS.folder}</span>`;
        btn.appendChild(Object.assign(document.createElement('span'), { textContent: child.name, className: 'gdt-label' }));
        btn.addEventListener('click', () => {
          if (expansion.has(child.path)) expansion.delete(child.path);
          else expansion.add(child.path);
          const nowOpen = expansion.has(child.path);
          btn.classList.toggle('gdt-open', nowOpen);
          sub.hidden = !nowOpen;
        });
        li.appendChild(btn);
        sub.hidden = !open;
        li.appendChild(sub);
      } else {
        if (!matchesFilter(child)) continue;
        const a = document.createElement('a');
        a.className = 'gdt-file';
        a.href = buildHash({ path: child.path });
        a.setAttribute('data-gdt-tree-path', child.path);
        a.innerHTML = `<span class="gdt-file-ico">${ICONS.file}</span>`;
        a.appendChild(Object.assign(document.createElement('span'), { textContent: docLabel(child), className: 'gdt-label' }));
        li.appendChild(a);
      }
      ul.appendChild(li);
    }
    return ul;
  }

  function renderPinned() {
    const pinnedDocs = docs.filter((d) => {
      const m = metaByPath.get(d.path);
      if (!m || !m.pinned) return false;
      if (!treeFilter) return true;
      const hay = `${displayTitleOf(m, d)} ${d.path}`.toLowerCase();
      return treeFilter.split(/\s+/).every((tok) => hay.includes(tok));
    });
    refs.pinnedList.textContent = '';
    if (!pinnedDocs.length) {
      refs.pinned.hidden = true;
      return;
    }
    refs.pinned.hidden = false;
    for (const d of pinnedDocs) {
      const a = document.createElement('a');
      a.className = 'gdt-file gdt-pin-item';
      a.href = buildHash({ path: d.path });
      a.setAttribute('data-gdt-tree-path', d.path);
      a.innerHTML = `<span class="gdt-file-ico gdt-pin-ico">${ICONS.pin}</span>`;
      a.appendChild(
        Object.assign(document.createElement('span'), { textContent: displayTitle(d.path), className: 'gdt-label' })
      );
      refs.pinnedList.appendChild(a);
    }
  }

  function markSelection() {
    for (const el of refs.sidebar.querySelectorAll('a[aria-current]')) el.removeAttribute('aria-current');
    if (!currentPath) return;
    const els = refs.sidebar.querySelectorAll(`a[data-gdt-tree-path="${cssEscape(currentPath)}"]`);
    els.forEach((el) => el.setAttribute('aria-current', 'page'));
    const inTree = refs.tree.querySelector(`a[data-gdt-tree-path="${cssEscape(currentPath)}"]`);
    if (inTree) inTree.scrollIntoView({ block: 'nearest' });
  }

  function expandAncestors(path) {
    let dir = dirname(path);
    let changed = false;
    while (dir) {
      if (!expansion.has(dir)) {
        expansion.add(dir);
        changed = true;
      }
      dir = dirname(dir);
    }
    return changed;
  }

  function cssEscape(s) {
    return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/["\\\]]/g, '\\$&');
  }

  function renderTags() {
    const tags = [...index.allTags().entries()].sort((a, b) => b[1] - a[1]).slice(0, 24);
    refs.tags.textContent = '';
    if (!tags.length) {
      refs.tags.hidden = true;
      return;
    }
    refs.tags.hidden = false;
    for (const [tag, count] of tags) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'gdt-tag-chip';
      chip.textContent = tag;
      const c = document.createElement('span');
      c.className = 'gdt-tag-count';
      c.textContent = String(count);
      chip.appendChild(c);
      chip.addEventListener('click', () => searchUI.setQuery(`tag:${tag} `));
      refs.tags.appendChild(chip);
    }
  }

  // ---- indexing -------------------------------------------------------------

  async function startIndexing() {
    if (indexState.started) return;
    indexState.started = true;
    const queue = [...docs];
    const limitBytes = (settings.contentSearchLimitKB || 200) * 1024;
    refs.progress.hidden = false;
    const tick = () => {
      refs.progress.textContent = `Indexing content… ${Math.round((indexState.done / Math.max(1, indexState.total)) * 100)}%`;
    };
    tick();
    const worker = async () => {
      while (queue.length) {
        const doc = queue.shift();
        try {
          if (doc.size && doc.size > limitBytes) continue;
          let source = contentCache.get(doc.path);
          if (source == null) {
            source = await client.getRawText(doc.path);
            contentCache.set(doc.path, source);
          }
          addToIndex(doc, source);
        } catch {
          // unreadable file: skip silently
        } finally {
          indexState.done++;
          if (indexState.done % 5 === 0 || indexState.done === indexState.total) tick();
        }
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    indexState.finished = true;
    refs.progress.hidden = true;
    sortTree(tree, displayMeta());
    flat = flattenTree(tree);
    if (mounted) {
      renderTree();
      renderTags();
      if (currentPath) renderPrevNext();
    }
  }

  function addToIndex(doc, source) {
    const { data, content } = parseFrontmatter(source);
    recordMeta(doc.path, data, bestHeadingTitle(content));
    const m = metaByPath.get(doc.path);
    index.add(doc.path, {
      text: mdToPlainText(content),
      title: (m && (m.fmTitle || m.headingTitle)) || doc.title,
      headings: extractHeadings(content),
      tags: (m && m.tags) || [],
    });
  }

  // ---- article --------------------------------------------------------------

  function defaultPath() {
    const rootIndex = tree.children.find((c) => !c.isDir && /^readme\./i.test(c.name));
    if (rootIndex) return rootIndex.doc.path;
    return flat.length ? flat[0].path : null;
  }

  async function renderRoute(route) {
    const target = route.path ?? defaultPath();
    if (editor) {
      if (target === editor.path) return; // stay in the editor
      if (!closeEditor(false)) {
        location.hash = buildHash({ path: editor.path });
        return;
      }
    }
    if (!target) {
      renderMessage('No documentation found', 'This repository has no markdown documents in its docs folders.');
      return;
    }
    if (target === currentPath && !refs.article.querySelector('[data-gdt-error]')) {
      if (route.heading) scrollToHeading(route.heading);
      return;
    }
    await renderArticle(target, route.heading ?? null);
  }

  async function renderArticle(path, heading) {
    const seq = ++loadSeq;
    currentPath = path;
    renderCrumbs(path);
    if (expandAncestors(path)) renderTree();
    else markSelection();
    refs.article.innerHTML = '<div class="gdt-loading"><div class="gdt-spinner"></div>Loading…</div>';
    refs.toc.hidden = true;

    let source = contentCache.get(path);
    if (source == null) {
      try {
        source = await client.getRawText(path);
        contentCache.set(path, source);
      } catch (err) {
        if (seq !== loadSeq) return;
        renderError(path, err);
        return;
      }
    }
    if (seq !== loadSeq) return;

    let rd;
    try {
      rd = renderDoc(md, source, { path, ctx });
    } catch (err) {
      renderMessage('Render failed', String((err && err.message) || err));
      return;
    }
    let headingTitle = null;
    if (rd.toc.length) {
      const minLevel = Math.min(...rd.toc.map((t) => t.level));
      headingTitle = (rd.toc.find((t) => t.level === minLevel) || {}).text || null;
    }
    const titleChanged = recordMeta(path, rd.meta, headingTitle);
    if (titleChanged) renderTree();

    const m = metaByPath.get(path);
    const doc = docByPath.get(path);
    const title = displayTitle(path);
    document.title = `${title} · Docs · ${client.owner}/${client.repo}`;
    refs.editGh.href = client.editUrl(path);
    refs.openGh.href = client.blobUrl(path);
    refs.liveEdit.disabled = false;
    refs.copyMd.disabled = false;

    refs.article.textContent = '';
    const header = buildArticleHeader(path, m, doc, rd);
    if (header) refs.article.appendChild(header);
    const body = document.createElement('div');
    body.className = 'gdt-md';
    body.appendChild(rd.fragment);
    refs.article.appendChild(body);
    renderPrevNext();
    renderToc(rd.toc);
    if (heading) scrollToHeading(heading);
    else window.scrollTo({ top: 0 });
  }

  function buildArticleHeader(path, m, doc, rd) {
    const hasMeta = m && m.data && Object.keys(m.data).length > 0;
    const isMdx = /\.mdx$/i.test(path);
    if (!hasMeta && !isMdx) return null;
    const wrap = document.createElement('div');
    wrap.className = 'gdt-doc-head';
    if (m && m.data && typeof m.data.title === 'string' && m.data.title.trim()) {
      const t = document.createElement('h1');
      t.className = 'gdt-doc-title';
      t.textContent = m.data.title;
      wrap.appendChild(t);
    }
    if (m && m.data && typeof m.data.description === 'string' && m.data.description.trim()) {
      const d = document.createElement('p');
      d.className = 'gdt-doc-desc';
      d.textContent = m.data.description;
      wrap.appendChild(d);
    }
    const badges = document.createElement('div');
    badges.className = 'gdt-doc-badges';
    if (isMdx) {
      const b = document.createElement('span');
      b.className = 'gdt-badge';
      b.textContent = 'MDX rendered as Markdown';
      badges.appendChild(b);
    }
    if (m && m.tags && m.tags.length) {
      for (const tag of m.tags) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'gdt-tag-chip gdt-tag-inline';
        chip.textContent = tag;
        chip.addEventListener('click', () => searchUI.setQuery(`tag:${tag} `));
        badges.appendChild(chip);
      }
    }
    if (badges.children.length) wrap.appendChild(badges);
    if (hasMeta) {
      const extra = Object.entries(m.data).filter(
        ([k]) => !['title', 'description', 'tags', 'keywords', 'categories'].includes(k)
      );
      if (extra.length) {
        const det = document.createElement('details');
        det.className = 'gdt-fm';
        const sum = document.createElement('summary');
        sum.textContent = 'Metadata';
        det.appendChild(sum);
        const dl = document.createElement('dl');
        for (const [k, v] of extra) {
          const dt = document.createElement('dt');
          dt.textContent = k;
          const dd = document.createElement('dd');
          dd.textContent = typeof v === 'object' ? JSON.stringify(v) : String(v);
          dl.appendChild(dt);
          dl.appendChild(dd);
        }
        det.appendChild(dl);
        wrap.appendChild(det);
      }
    }
    return wrap.children.length ? wrap : null;
  }

  function renderCrumbs(path) {
    const crumbs = refs.crumbs;
    crumbs.textContent = '';
    const mkLink = (text, hash) => {
      const a = document.createElement('a');
      a.textContent = text;
      a.href = hash;
      return a;
    };
    crumbs.appendChild(mkLink('Docs', buildHash({})));
    const segs = path.split('/');
    let acc = '';
    segs.forEach((seg, i) => {
      const sep = document.createElement('span');
      sep.className = 'gdt-crumb-sep';
      sep.textContent = '/';
      crumbs.appendChild(sep);
      acc = acc ? `${acc}/${seg}` : seg;
      if (i === segs.length - 1) {
        const cur = document.createElement('span');
        cur.className = 'gdt-crumb-current';
        cur.textContent = displayTitle(path) || seg;
        crumbs.appendChild(cur);
      } else {
        const node = findNode(tree, acc);
        const idx = node && node.isDir ? dirIndexDoc(node) : null;
        if (idx) crumbs.appendChild(mkLink(seg, buildHash({ path: idx.path })));
        else {
          const s = document.createElement('span');
          s.textContent = seg;
          crumbs.appendChild(s);
        }
      }
    });
  }

  function renderPrevNext() {
    refs.article.querySelector('.gdt-prevnext')?.remove();
    const i = flat.findIndex((d) => d.path === currentPath);
    if (i === -1) return;
    const wrap = document.createElement('nav');
    wrap.className = 'gdt-prevnext';
    const mk = (doc, cls, label) => {
      const a = document.createElement('a');
      a.className = `gdt-pn ${cls}`;
      a.href = buildHash({ path: doc.path });
      const l = document.createElement('span');
      l.className = 'gdt-pn-label';
      l.textContent = label;
      const t = document.createElement('span');
      t.className = 'gdt-pn-title';
      t.textContent = displayTitle(doc.path);
      a.appendChild(l);
      a.appendChild(t);
      return a;
    };
    if (i > 0) wrap.appendChild(mk(flat[i - 1], 'gdt-prev', '← Previous'));
    if (i < flat.length - 1) wrap.appendChild(mk(flat[i + 1], 'gdt-next', 'Next →'));
    if (wrap.children.length) refs.article.appendChild(wrap);
  }

  function renderToc(toc) {
    const entries = toc.filter((t) => t.level >= 1 && t.level <= 3);
    if (tocObserver) {
      tocObserver.disconnect();
      tocObserver = null;
    }
    if (entries.length < 2) {
      refs.toc.hidden = true;
      return;
    }
    refs.toc.hidden = false;
    refs.toc.textContent = '';
    const title = document.createElement('div');
    title.className = 'gdt-toc-title';
    title.textContent = 'On this page';
    refs.toc.appendChild(title);
    const ul = document.createElement('ul');
    for (const entry of entries) {
      const li = document.createElement('li');
      li.className = `gdt-toc-l${entry.level}`;
      const a = document.createElement('a');
      a.textContent = entry.text;
      a.href = buildHash({ path: currentPath, heading: entry.slug });
      a.setAttribute('data-gdt-toc-slug', entry.slug);
      li.appendChild(a);
      ul.appendChild(li);
    }
    refs.toc.appendChild(ul);

    tocObserver = new IntersectionObserver(
      (obsEntries) => {
        for (const oe of obsEntries) {
          if (oe.isIntersecting) {
            for (const link of refs.toc.querySelectorAll('a.gdt-toc-active')) link.classList.remove('gdt-toc-active');
            const link = refs.toc.querySelector(`a[data-gdt-toc-slug="${cssEscape(oe.target.id)}"]`);
            if (link) link.classList.add('gdt-toc-active');
          }
        }
      },
      { rootMargin: '0px 0px -75% 0px' }
    );
    for (const entry of entries) {
      const el = refs.article.querySelector(`#${cssEscape(entry.slug)}`);
      if (el) tocObserver.observe(el);
    }
  }

  function scrollToHeading(anchor) {
    if (!anchor) return;
    const tryIds = [anchor, githubSlug(anchor), `user-content-${anchor}`];
    for (const id of tryIds) {
      const el = refs.article.querySelector(`#${cssEscape(id)}`) || refs.article.querySelector(`[name="${cssEscape(id)}"]`);
      if (el) {
        el.scrollIntoView({ block: 'start' });
        el.classList.add('gdt-flash');
        setTimeout(() => el.classList.remove('gdt-flash'), 1600);
        return;
      }
    }
  }

  function renderMessage(title, body) {
    refs.article.textContent = '';
    const box = document.createElement('div');
    box.className = 'gdt-message';
    box.setAttribute('data-gdt-error', '');
    const t = document.createElement('h2');
    t.textContent = title;
    const p = document.createElement('p');
    p.textContent = body;
    box.appendChild(t);
    box.appendChild(p);
    refs.article.appendChild(box);
    return box;
  }

  function renderError(path, err) {
    if (err instanceof RateLimitError) {
      const when = err.resetAt ? ` Limits reset at ${new Date(err.resetAt).toLocaleTimeString()}.` : '';
      const box = renderMessage(
        'GitHub rate limit reached',
        `Anonymous GitHub API access is limited to 60 requests/hour.${when} ` +
          'Add a personal access token in the extension options (click the extension icon in your toolbar) ' +
          'to raise the limit to 5,000/hour and enable private repositories.'
      );
      box.classList.add('gdt-ratelimit');
      return;
    }
    const box = renderMessage('Could not load document', `${path}: ${(err && err.message) || err}`);
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'gdt-btn';
    retry.textContent = 'Retry';
    retry.addEventListener('click', () => {
      contentCache.delete(path);
      const p = currentPath;
      currentPath = null;
      renderArticle(p, null);
    });
    box.appendChild(retry);
  }

  // ---- live editor ----------------------------------------------------------

  async function openEditor(path) {
    let source = contentCache.get(path);
    if (source == null) {
      try {
        source = await client.getRawText(path);
        contentCache.set(path, source);
      } catch (err) {
        renderError(path, err);
        return;
      }
    }
    if (editor && !closeEditor(false)) return;
    if (tocObserver) {
      tocObserver.disconnect();
      tocObserver = null;
    }
    refs.toc.hidden = true;
    refs.article.textContent = '';
    buildEditor(path, source);
    updateEditorState(true);
  }

  function closeEditor(silent) {
    if (!editor) return true;
    if (!silent && editor.dirty && !window.confirm('Discard your unsaved edits?')) return false;
    const path = editor.path;
    editor.el.remove();
    editor = null;
    if (!silent && mounted) {
      currentPath = null; // force re-render of the article
      renderArticle(path, null);
    }
    return true;
  }

  function buildEditor(path, source) {
    const el = h(`
      <div class="gdt-editor">
        <div class="gdt-ed-toolbar" data-ed-toolbar>
          <span class="gdt-ed-file">${md.utils.escapeHtml(path)}</span>
        </div>
        <div class="gdt-ed-split">
          <textarea class="gdt-ed-source" spellcheck="false" aria-label="Markdown source"></textarea>
          <div class="gdt-ed-preview"><article class="gdt-md" data-ed-preview></article></div>
        </div>
        <div class="gdt-ed-footer">
          <span class="gdt-ed-status" data-ed-status></span>
          <span class="gdt-ed-actions">
            <button type="button" class="gdt-btn" data-ed-cancel>Cancel</button>
            <button type="button" class="gdt-btn" data-ed-copy-patch>Copy patch</button>
            <button type="button" class="gdt-btn" data-ed-download>Download .patch</button>
            <button type="button" class="gdt-btn" data-ed-github title="Opens GitHub's own editor pre-filled with your changes — commit with your logged-in account">Propose via GitHub editor</button>
            <button type="button" class="gdt-btn gdt-btn-primary" data-ed-pr>Create pull request…</button>
          </span>
        </div>
      </div>
    `);
    const textarea = el.querySelector('.gdt-ed-source');
    textarea.value = source;
    editor = {
      path,
      original: source,
      el,
      textarea,
      preview: el.querySelector('[data-ed-preview]'),
      status: el.querySelector('[data-ed-status]'),
      dirty: false,
      buttons: ['[data-ed-copy-patch]', '[data-ed-download]', '[data-ed-github]', '[data-ed-pr]'].map((sel) =>
        el.querySelector(sel)
      ),
    };

    const TOOLS = [
      ['B', 'Bold', () => wrapSelection('**')],
      ['I', 'Italic', () => wrapSelection('_')],
      ['S̶', 'Strikethrough', () => wrapSelection('~~')],
      ['<>', 'Inline code', () => wrapSelection('`')],
      ['H2', 'Heading', () => prefixLines('## ')],
      ['•', 'List item', () => prefixLines('- ')],
      ['☑', 'Task item', () => prefixLines('- [ ] ')],
      ['❝', 'Quote', () => prefixLines('> ')],
      ['🔗', 'Link', () => insertAtSelection('[', '](https://)')],
      ['[[ ]]', 'Wiki link', () => insertAtSelection('[[', ']]')],
    ];
    const toolbar = el.querySelector('[data-ed-toolbar]');
    for (const [label, title, run] of TOOLS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'gdt-ed-btn';
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', () => {
        run();
        textarea.focus();
        onEdited();
      });
      toolbar.appendChild(b);
    }

    let previewTimer = 0;
    const onEdited = () => {
      updateEditorState(false);
      clearTimeout(previewTimer);
      previewTimer = setTimeout(() => updateEditorState(true), 250);
    };
    textarea.addEventListener('input', onEdited);
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        insertAtSelection('  ', '');
        onEdited();
      }
    });

    el.querySelector('[data-ed-cancel]').addEventListener('click', () => closeEditor(false));
    el.querySelector('[data-ed-download]').addEventListener('click', downloadPatch);
    el.querySelector('[data-ed-copy-patch]').addEventListener('click', copyPatch);
    el.querySelector('[data-ed-github]').addEventListener('click', proposeViaGitHub);
    el.querySelector('[data-ed-pr]').addEventListener('click', () => openPrModal());
    refs.article.appendChild(el);
    textarea.focus();
  }

  function updateEditorState(renderPreview) {
    if (!editor) return;
    const val = editor.textarea.value;
    editor.dirty = val !== editor.original;
    editor.status.textContent = editor.dirty ? 'Unsaved changes' : 'No changes yet';
    for (const b of editor.buttons) b.disabled = !editor.dirty;
    if (renderPreview) {
      try {
        const rd = renderDoc(md, val, { path: editor.path, ctx });
        editor.preview.textContent = '';
        editor.preview.appendChild(rd.fragment);
      } catch (err) {
        editor.preview.textContent = `Preview error: ${(err && err.message) || err}`;
      }
    }
  }

  function wrapSelection(marker) {
    const ta = editor.textarea;
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const inner = value.slice(s, e) || 'text';
    ta.value = value.slice(0, s) + marker + inner + marker + value.slice(e);
    ta.setSelectionRange(s + marker.length, s + marker.length + inner.length);
  }

  function insertAtSelection(before, after) {
    const ta = editor.textarea;
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const inner = value.slice(s, e);
    ta.value = value.slice(0, s) + before + inner + after + value.slice(e);
    const pos = s + before.length + inner.length;
    ta.setSelectionRange(pos, pos);
  }

  function prefixLines(prefix) {
    const ta = editor.textarea;
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const lineStart = value.lastIndexOf('\n', s - 1) + 1;
    const lineEnd = value.indexOf('\n', e) === -1 ? value.length : value.indexOf('\n', e);
    const block = value.slice(lineStart, lineEnd);
    const prefixed = block
      .split('\n')
      .map((l) => (l.startsWith(prefix) ? l.slice(prefix.length) : prefix + l))
      .join('\n');
    ta.value = value.slice(0, lineStart) + prefixed + value.slice(lineEnd);
    ta.setSelectionRange(lineStart, lineStart + prefixed.length);
  }

  function currentPatch() {
    return buildUnifiedPatch(editor.path, editor.original, editor.textarea.value);
  }

  function downloadPatch() {
    const patch = currentPatch();
    if (!patch) return;
    const url = URL.createObjectURL(new Blob([patch], { type: 'text/x-patch' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${basename(editor.path)}.patch`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    editor.status.textContent = `Patch downloaded — apply with: git apply ${basename(editor.path)}.patch`;
  }

  function copyPatch() {
    const patch = currentPatch();
    if (!patch) return;
    navigator.clipboard
      .writeText(patch)
      .then(() => (editor.status.textContent = 'Patch copied to clipboard'))
      .catch(() => (editor.status.textContent = 'Clipboard unavailable — use Download instead'));
  }

  async function proposeViaGitHub() {
    const path = editor.path;
    const content = editor.textarea.value;
    try {
      await ext.storage.local.set({
        'gdt:pending-edit': { owner: client.owner, repo: client.repo, path, content, savedAt: Date.now() },
      });
    } catch {
      editor.status.textContent = 'Could not stash the edit — try Download .patch instead.';
      return;
    }
    let branch = 'main';
    try {
      branch = (await client.getRepoInfo()).defaultBranch;
    } catch {
      // default guess is fine; GitHub will 404 visibly if wrong
    }
    editor.dirty = false; // handing off — do not block navigation with a confirm
    location.href = editPageUrl(client.owner, client.repo, branch, path);
  }

  function openPrModal() {
    const path = editor.path;
    const backdrop = h(`
      <div class="gdt-modal-backdrop">
        <div class="gdt-modal" role="dialog" aria-label="Create pull request">
          <h3>Propose change as pull request</h3>
          <label>Commit message <input data-pr-msg autocomplete="off" spellcheck="false" /></label>
          <label>Branch name <input data-pr-branch autocomplete="off" spellcheck="false" /></label>
          <label>Pull request title <input data-pr-title autocomplete="off" /></label>
          <label>Description <textarea data-pr-body rows="3"></textarea></label>
          <p class="gdt-modal-note" data-pr-note></p>
          <div class="gdt-modal-actions">
            <button type="button" class="gdt-btn" data-pr-cancel>Cancel</button>
            <button type="button" class="gdt-btn gdt-btn-primary" data-pr-go>Create pull request</button>
          </div>
          <p class="gdt-modal-progress" data-pr-progress hidden aria-live="polite"></p>
        </div>
      </div>
    `);
    const q = (sel) => backdrop.querySelector(sel);
    const msg = defaultCommitMessage(path);
    q('[data-pr-msg]').value = msg;
    q('[data-pr-branch]').value = branchNameFor(path, Math.random().toString(36).slice(2, 8));
    q('[data-pr-title]').value = msg;
    q('[data-pr-body]').value = 'Proposed from the GitHub Docs Tab extension.';
    if (!client.hasToken) {
      q('[data-pr-note]').textContent =
        'A GitHub token with Contents and Pull requests (write) permission is required — add one in the extension options, or use "Propose via GitHub editor" instead.';
      q('[data-pr-go]').disabled = true;
    } else {
      q('[data-pr-note]').textContent =
        'Creates a branch and a single-file commit, then opens a pull request. Your fork is used automatically if you lack push access.';
    }
    const closeModal = () => backdrop.remove();
    q('[data-pr-cancel]').addEventListener('click', closeModal);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal();
    });
    q('[data-pr-go]').addEventListener('click', async () => {
      const progress = q('[data-pr-progress]');
      progress.hidden = false;
      q('[data-pr-go]').disabled = true;
      q('[data-pr-cancel]').disabled = true;
      try {
        const result = await client.createEditPr({
          path,
          content: editor.textarea.value,
          message: q('[data-pr-msg]').value.trim() || msg,
          branch: q('[data-pr-branch]').value.trim() || branchNameFor(path, Math.random().toString(36).slice(2, 8)),
          title: q('[data-pr-title]').value.trim() || msg,
          body: q('[data-pr-body]').value,
          onProgress: (t) => (progress.textContent = t),
        });
        editor.original = editor.textarea.value; // committed — no longer dirty
        updateEditorState(false);
        const panel = q('.gdt-modal');
        panel.textContent = '';
        const done = h(
          `<div><h3>Pull request created</h3><p><a class="gdt-btn gdt-btn-primary" target="_blank" rel="noopener noreferrer" href="${result.url}">Open pull request #${result.number} ↗</a></p><p><button type="button" class="gdt-btn" data-pr-close>Close</button></p></div>`
        );
        panel.appendChild(done);
        panel.querySelector('[data-pr-close]').addEventListener('click', closeModal);
      } catch (err) {
        progress.textContent = `Failed: ${(err && err.message) || err}`;
        q('[data-pr-go]').disabled = false;
        q('[data-pr-cancel]').disabled = false;
      }
    });
    root.appendChild(backdrop);
  }

  // ---- public ---------------------------------------------------------------

  return {
    async open(route) {
      if (!root) buildDom();
      if (!mounted) {
        if (!mount()) return;
        applyTheme();
        startIndexing();
      }
      await renderRoute(route);
    },
    close,
    isOpen: () => mounted,
  };
}
