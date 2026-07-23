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

let current = null; // { key, owner, repo, loading, settings, client, docs, truncated, total, viewer }
let scanTimer = 0;

// scan() is called repeatedly (boot, Turbo loads, mutation storms during
// GitHub's hydration). It must be idempotent and race-free: overlapping calls
// for the same repo are collapsed via current.loading, and a repo switch
// invalidates in-flight loads by object identity (current !== me).
async function scan() {
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
    if (current.docs) {
      if (current.docs.length) {
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
    if (current.loading) return;
    // previous attempt died without finishing — fall through and retry
  } else {
    current?.viewer?.close();
    current = { key, ...repoInfo };
  }

  const me = current;
  me.loading = true;
  try {
    const settings = await loadSettings();
    if (current !== me) return;
    me.settings = settings;
    me.client = makeClient({
      owner: me.owner,
      repo: me.repo,
      token: settings.token,
      candidateFolders: settings.docsFolders,
    });
    const treeRes = await me.client.getTree();
    if (current !== me) return;
    const { docs, truncated, total } = collectDocs(treeRes.entries, {
      folders: settings.docsFolders,
      includeRootFiles: settings.includeRootFiles,
      maxFiles: settings.maxFiles,
    });
    me.docs = docs;
    me.truncated = truncated || treeRes.truncated;
    me.total = total;
    if (docs.length) {
      ensureTab({ owner: me.owner, repo: me.repo, count: total, showBadge: settings.showBadge });
      applyRoute();
    }
  } catch (err) {
    // No tab on rate-limited/private/empty repos we cannot read. The DOM
    // attribute makes failures diagnosable from the page (issue reports).
    console.debug('[github-docs-tab]', err && err.message);
    document.documentElement.setAttribute('data-gdt-error', `${err && err.name}: ${err && err.message}`.slice(0, 300));
  } finally {
    me.loading = false;
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
  // Covers: nav re-rendered by Turbo (tab vanished), nav appearing after our
  // boot scan, and recovery from a died load. Repos confirmed to have zero
  // docs are excluded so we don't rescan forever.
  if (!findRepoNav() || tabConnected()) return;
  if (current && current.docs && !current.docs.length) return;
  scheduleScan();
});
observer.observe(document.documentElement, { childList: true, subtree: true });

onSettingsChanged(() => {
  const old = current;
  current = null;
  old?.viewer?.close();
  removeTab();
  scheduleScan();
});

document.documentElement.setAttribute('data-gdt-boot', '1');
scan().catch((err) => {
  document.documentElement.setAttribute('data-gdt-error', `boot ${err && err.name}: ${err && err.message}`.slice(0, 300));
});
