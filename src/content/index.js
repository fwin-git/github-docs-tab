// Content-script entry: detects repo pages, injects the Docs tab, routes
// #docs hashes to the viewer, and survives GitHub's Turbo soft navigation.
import { parseHash } from '../common/route.js';
import { ext } from '../common/browser.js';
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
    document.documentElement.removeAttribute('data-gdt-error'); // stale diagnostics confuse debugging
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

// In-viewer preferences (theme, title mode) are handled by the viewer itself —
// only changes that affect what we collect or show require a full rebuild.
const REBUILD_KEYS = ['token', 'docsFolders', 'includeRootFiles', 'maxFiles', 'showBadge', 'contentSearchLimitKB'];

onSettingsChanged((next) => {
  if (current && current.settings) {
    const needsRebuild = REBUILD_KEYS.some((k) => JSON.stringify(next[k]) !== JSON.stringify(current.settings[k]));
    current.settings = { ...current.settings, theme: next.theme, titleMode: next.titleMode };
    if (!needsRebuild) return;
  }
  const old = current;
  current = null;
  old?.viewer?.close();
  removeTab();
  scheduleScan();
});

// ---- "Propose via GitHub editor" handoff ------------------------------------
// The viewer stashes edited content and navigates to GitHub's own /edit/ page;
// here (also github.com, so this content script runs) we pre-fill GitHub's
// editor so the user commits with their own logged-in account.

function parseEditPage(pathname) {
  const segs = pathname.split('/').filter(Boolean);
  if (segs.length >= 5 && segs[2] === 'edit') {
    return { owner: segs[0], repo: segs[1], path: segs.slice(4).map(decodeURIComponent).join('/') };
  }
  return null;
}

function showToast(text, copyContent) {
  document.querySelector('.gdt-toast')?.remove();
  const toast = document.createElement('div');
  toast.className = 'gdt-toast';
  const span = document.createElement('span');
  span.textContent = text;
  toast.appendChild(span);
  if (copyContent) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Copy edited content';
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(copyContent).then(
        () => (btn.textContent = 'Copied ✓'),
        () => (btn.textContent = 'Copy failed')
      );
    });
    toast.appendChild(btn);
  }
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'gdt-toast-x';
  x.textContent = '×';
  x.addEventListener('click', () => toast.remove());
  toast.appendChild(x);
  document.body.appendChild(toast);
  if (!copyContent) setTimeout(() => toast.remove(), 20000);
}

async function maybePrefillGithubEditor() {
  const stage = (s) => document.documentElement.setAttribute('data-gdt-prefill', s);
  const info = parseEditPage(location.pathname);
  if (!info) return;
  stage('edit-page');
  let stored;
  try {
    stored = (await ext.storage.local.get('gdt:pending-edit'))['gdt:pending-edit'];
  } catch (err) {
    stage('storage-error:' + (err && err.message));
    return;
  }
  if (!stored || stored.owner !== info.owner || stored.repo !== info.repo || stored.path !== info.path) {
    stage('no-match');
    return;
  }
  stage('matched');
  if (Date.now() - stored.savedAt > 10 * 60 * 1000) {
    ext.storage.local.remove('gdt:pending-edit');
    return;
  }
  const deadline = Date.now() + 12000;
  const finish = (success) => {
    ext.storage.local.remove('gdt:pending-edit');
    showToast(
      success
        ? 'Docs Tab: your edited content is filled in below — review it and use "Commit changes…".'
        : "Docs Tab: couldn't auto-fill GitHub's editor. Copy your edited content and paste it (select all first).",
      success ? null : stored.content
    );
  };
  stage('polling');
  const timer = setInterval(() => {
    const cm = document.querySelector('.cm-content');
    const ta = document.querySelector('textarea[name="value"]');
    if (ta) {
      clearInterval(timer);
      stage('filling-textarea');
      ta.value = stored.content;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      finish(true);
    } else if (cm) {
      clearInterval(timer);
      let ok = false;
      try {
        cm.focus();
        document.execCommand('selectAll');
        ok = document.execCommand('insertText', false, stored.content);
      } catch {
        ok = false;
      }
      finish(ok);
    } else if (Date.now() > deadline) {
      clearInterval(timer);
      finish(false);
    }
  }, 400);
}

document.documentElement.setAttribute('data-gdt-boot', '1');
scan().catch((err) => {
  document.documentElement.setAttribute('data-gdt-error', `boot ${err && err.name}: ${err && err.message}`.slice(0, 300));
});
maybePrefillGithubEditor();
