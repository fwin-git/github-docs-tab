// The docs viewer UI: mounts inside GitHub's <main>, hides the original page
// content (restored on close), and renders sidebar tree / article / TOC /
// search. All remote markdown goes through render-doc.js (DOMPurify).
import {
  buildTree,
  sortTree,
  flattenTree,
  findNode,
  dirIndexDoc,
} from '../common/docs-model.js';
import { buildResolver } from '../common/wikilinks.js';
import { ContentIndex } from '../common/search.js';
import { normalizeTags, docTitle, parseFrontmatter, isPinned } from '../common/frontmatter.js';
import { resolveRelative, splitAnchor, isMarkdownPath, dirname, basename } from '../common/paths.js';
import { buildHash } from '../common/route.js';
import { githubSlug } from '../common/slugger.js';
import { mdToPlainText, extractHeadings } from '../common/md-text.js';
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
  menu:
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M1 2.75A.75.75 0 0 1 1.75 2h12.5a.75.75 0 0 1 0 1.5H1.75A.75.75 0 0 1 1 2.75Zm0 5A.75.75 0 0 1 1.75 7h12.5a.75.75 0 0 1 0 1.5H1.75A.75.75 0 0 1 1 7.75ZM1.75 12h12.5a.75.75 0 0 1 0 1.5H1.75a.75.75 0 0 1 0-1.5Z"></path></svg>',
};

export function createViewer({ client, settings, docs, truncated, total, onRequestRefresh }) {
  const docByPath = new Map(docs.map((d) => [d.path, d]));
  const metaByPath = new Map();
  const contentCache = new Map();
  const index = new ContentIndex();
  const tree = buildTree(docs);
  sortTree(tree, metaByPath);
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
  let treeFilter = '';

  // ---- markdown context -----------------------------------------------------

  function ensureResolver() {
    if (resolverDirty) {
      resolver = buildResolver(docs, metaByPath);
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

  function recordMeta(path, data) {
    if (!data) return false;
    const doc = docByPath.get(path);
    const rec = {
      title: docTitle(data, doc ? doc.title : basename(path)),
      tags: normalizeTags(data),
      order: typeof data.order === 'number' ? data.order : undefined,
      sidebar_position: typeof data.sidebar_position === 'number' ? data.sidebar_position : undefined,
      pinned: isPinned(data),
      data,
    };
    const prev = metaByPath.get(path);
    metaByPath.set(path, rec);
    resolverDirty = true;
    return !prev || prev.title !== rec.title;
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
              <button class="gdt-iconbtn" data-gdt-refresh type="button" title="Refresh docs list">${ICONS.refresh}</button>
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
                <button class="gdt-iconbtn" data-gdt-theme-toggle type="button" title="Theme: auto">${ICONS.theme}</button>
                <a class="gdt-iconbtn" data-gdt-open-gh target="_blank" rel="noopener noreferrer" title="View on GitHub">${ICONS.github}</a>
                <a class="gdt-iconbtn" data-gdt-edit-gh target="_blank" rel="noopener noreferrer" title="Edit on GitHub">${ICONS.edit}</a>
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
      getMeta: () => metaByPath,
      getIndex: () => index,
      getIndexState: () => indexState,
      onNavigate: ({ path, heading }) => {
        location.hash = buildHash({ path, heading });
      },
    });

    root.querySelector('[data-gdt-refresh]').addEventListener('click', () => {
      if (onRequestRefresh) onRequestRefresh();
    });
    root.querySelector('[data-gdt-side-toggle]').addEventListener('click', () => {
      root.classList.toggle('gdt-side-open');
    });
    refs.themeToggle.addEventListener('click', cycleTheme);

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
    refs.themeToggle.title = `Theme: ${theme} (click to change)`;
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
    const m = metaByPath.get(child.path);
    return (m && m.title) || child.doc.title;
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
      const hay = `${m.title} ${d.path}`.toLowerCase();
      return treeFilter.split(/\s+/).every((tok) => hay.includes(tok));
    });
    refs.pinnedList.textContent = '';
    if (!pinnedDocs.length) {
      refs.pinned.hidden = true;
      return;
    }
    refs.pinned.hidden = false;
    for (const d of pinnedDocs) {
      const m = metaByPath.get(d.path);
      const a = document.createElement('a');
      a.className = 'gdt-file gdt-pin-item';
      a.href = buildHash({ path: d.path });
      a.setAttribute('data-gdt-tree-path', d.path);
      a.innerHTML = `<span class="gdt-file-ico gdt-pin-ico">${ICONS.pin}</span>`;
      a.appendChild(
        Object.assign(document.createElement('span'), { textContent: (m && m.title) || d.title, className: 'gdt-label' })
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
    sortTree(tree, metaByPath);
    flat = flattenTree(tree);
    if (mounted) {
      renderTree();
      renderTags();
      if (currentPath) renderPrevNext();
    }
  }

  function addToIndex(doc, source) {
    const { data, content } = parseFrontmatter(source);
    recordMeta(doc.path, data);
    const m = metaByPath.get(doc.path);
    index.add(doc.path, {
      text: mdToPlainText(content),
      title: (m && m.title) || doc.title,
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
    const titleChanged = recordMeta(path, rd.meta);
    if (titleChanged) renderTree();

    const m = metaByPath.get(path);
    const doc = docByPath.get(path);
    const title = (m && m.title) || (doc && doc.title) || basename(path);
    document.title = `${title} · Docs · ${client.owner}/${client.repo}`;
    refs.editGh.href = client.editUrl(path);
    refs.openGh.href = client.blobUrl(path);

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
        const m = metaByPath.get(path);
        cur.textContent = (m && m.title) || seg;
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
      const m = metaByPath.get(doc.path);
      t.textContent = (m && m.title) || doc.title;
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
