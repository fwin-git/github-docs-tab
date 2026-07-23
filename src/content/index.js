// Content-script entry: detects repo pages, injects the Docs tab, routes
// #docs hashes to the viewer, and survives GitHub's Turbo soft navigation.
import { parseHash } from '../common/route.js';
import { loadSettings, onSettingsChanged } from '../common/settings.js';
import { makeClient } from './github-api.js';
import { collectDocs } from '../common/docs-model.js';
import { ensureTab, setTabActive, findRepoNav, tabConnected, removeTab } from './tab.js';
import { createViewer } from './viewer.js';

const RESERVED_OWNERS = new Set([
  'about',
  'account',
  'apps',
  'codespaces',
  'collections',
  'contact',
  'customer-stories',
  'dashboard',
  'enterprise',
  'events',
  'explore',
  'features',
  'gist',
  'integrations',
  'issues',
  'join',
  'login',
  'logout',
  'marketplace',
  'new',
  'notifications',
  'organizations',
  'orgs',
  'pricing',
  'pulls',
  'search',
  'security',
  'sessions',
  'settings',
  'sponsors',
  'topics',
  'trending',
]);

function parseRepo(pathname) {
  const segs = pathname.split('/').filter(Boolean);
  if (segs.length < 2) return null;
  const [owner, repo] = segs;
  if (RESERVED_OWNERS.has(owner.toLowerCase())) return null;
  return { owner, repo };
}

let current = null; // { key, owner, repo, settings, client, docs, truncated, total, viewer }
let scanSeq = 0;
let scanTimer = 0;

async function scan() {
  const seq = ++scanSeq;
  const repoInfo = parseRepo(location.pathname);
  const nav = findRepoNav();

  if (!repoInfo || !nav) {
    if (current) {
      current.viewer?.close();
      current = null;
    }
    return;
  }

  const key = `${repoInfo.owner}/${repoInfo.repo}`;
  if (current && current.key === key) {
    if (current.docs && current.docs.length) {
      ensureTab({
        owner: current.owner,
        repo: current.repo,
        count: current.total,
        showBadge: current.settings.showBadge,
      });
    }
    applyRoute();
    return;
  }

  current?.viewer?.close();
  current = { key, ...repoInfo };

  const settings = await loadSettings();
  if (seq !== scanSeq || !current || current.key !== key) return;
  current.settings = settings;
  current.client = makeClient({
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    token: settings.token,
    candidateFolders: settings.docsFolders,
  });

  try {
    const treeRes = await current.client.getTree();
    if (seq !== scanSeq || !current || current.key !== key) return;
    const { docs, truncated, total } = collectDocs(treeRes.entries, {
      folders: settings.docsFolders,
      includeRootFiles: settings.includeRootFiles,
      maxFiles: settings.maxFiles,
    });
    current.docs = docs;
    current.truncated = truncated || treeRes.truncated;
    current.total = total;
    if (docs.length) {
      ensureTab({ owner: repoInfo.owner, repo: repoInfo.repo, count: total, showBadge: settings.showBadge });
      applyRoute();
    }
  } catch (err) {
    // No tab on rate-limited/private/empty repos we cannot read.
    console.debug('[github-docs-tab]', err && err.message);
  }
}

function getViewer() {
  if (!current || !current.docs || !current.docs.length) return null;
  if (!current.viewer) {
    current.viewer = createViewer({
      client: current.client,
      settings: current.settings,
      docs: current.docs,
      truncated: current.truncated,
      total: current.total,
      onRequestRefresh: refreshRepo,
    });
  }
  return current.viewer;
}

async function refreshRepo() {
  if (!current) return;
  const { client, settings, key } = current;
  try {
    const treeRes = await client.getTree({ force: true });
    if (!current || current.key !== key) return;
    const { docs, truncated, total } = collectDocs(treeRes.entries, {
      folders: settings.docsFolders,
      includeRootFiles: settings.includeRootFiles,
      maxFiles: settings.maxFiles,
    });
    current.viewer?.close();
    current.viewer = null;
    current.docs = docs;
    current.truncated = truncated || treeRes.truncated;
    current.total = total;
    ensureTab({ owner: current.owner, repo: current.repo, count: total, showBadge: settings.showBadge });
    applyRoute();
  } catch (err) {
    console.debug('[github-docs-tab] refresh failed', err && err.message);
  }
}

function applyRoute() {
  const route = parseHash(location.hash);
  if (route) {
    const viewer = getViewer();
    if (viewer) {
      viewer.open(route);
      setTabActive(true);
      return;
    }
  }
  if (current?.viewer?.isOpen()) current.viewer.close();
  setTabActive(false);
}

function scheduleScan() {
  clearTimeout(scanTimer);
  scanTimer = setTimeout(scan, 200);
}

window.addEventListener('hashchange', applyRoute);
window.addEventListener('popstate', applyRoute);
document.addEventListener('turbo:load', scheduleScan);
document.addEventListener('turbo:render', scheduleScan);
document.addEventListener('soft-nav:success', scheduleScan);
document.addEventListener('pjax:end', scheduleScan);

const observer = new MutationObserver(() => {
  // Nav got re-rendered by Turbo and our tab vanished — put it back.
  if (current && current.docs && current.docs.length && findRepoNav() && !tabConnected()) scheduleScan();
  else if (!current && findRepoNav()) scheduleScan();
});
observer.observe(document.documentElement, { childList: true, subtree: true });

onSettingsChanged(() => {
  const old = current;
  current = null;
  old?.viewer?.close();
  removeTab();
  scheduleScan();
});

scan();
