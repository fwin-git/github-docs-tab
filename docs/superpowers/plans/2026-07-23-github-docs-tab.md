# GitHub Docs Tab Implementation Plan

> **Status: COMPLETE (2026-07-23).** All tasks executed inline. 95 unit tests green; build + zips verified; full user journey verified in the browser harness (tab injection, viewer, wiki/relative links, phrase search with heading jump, tags, pinned section, tree filter, themes, close/restore). Post-plan additions from user feedback: sidebar folder icons + larger type, live tree filter, frontmatter-pinned section.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline execution chosen — same-session author/executor). Steps use checkbox (`- [ ]`) syntax for tracking.
> Note: this plan is executed by its author in the same session with the full spec in context, so tasks specify exact interfaces, behaviors, and test cases rather than duplicating complete implementation bodies.

**Goal:** MV3 browser extension (Chrome ≥121, Firefox ≥121) that adds a "Docs" tab to GitHub repo pages with a full markdown-docs viewer (tree, search, wiki links, tags, theming).

**Architecture:** Single content script (no background) bundled by esbuild from ESM sources; pure logic lives in `src/common/*` (node-testable), browser integration in `src/content/*`. GitHub trees API + raw.githubusercontent with ETag/storage caching. Hash routing `#docs/<path>?h=<slug>`.

**Tech Stack:** vanilla JS ESM, esbuild, markdown-it (+markdown-it-footnote), DOMPurify, highlight.js (common), node:test.

## Global Constraints

- Manifest V3; one manifest for both browsers; no background script; permissions: `storage` only; content script matches `https://github.com/*`.
- All rendered markdown MUST pass through DOMPurify before DOM insertion (we inject into github.com origin).
- All DOM/CSS scoped: ids/classes prefixed `gdt-`; every GitHub-DOM query null-guarded.
- Zero runtime network calls except `api.github.com` / `raw.githubusercontent.com`.
- Pure modules must not reference `window`/`chrome`/`document`.
- Tests: `npm test` = `node --test tests/`. Build: `npm run build` → `dist/` + store zips.

---

### Task 1: Scaffold
**Files:** `package.json`, `.gitignore`, `build.mjs`, `manifest.json`, `icons/gen-icons.mjs` (+ generated `icons/icon{16,32,48,128}.png`)
- [x] npm init (type: module), install deps (markdown-it, markdown-it-footnote, dompurify, highlight.js; dev: esbuild); scripts: `build`, `test`, `icons`.
- [x] Manifest per Global Constraints + `action.default_popup`, `options_ui`, `browser_specific_settings.gecko.id = "github-docs-tab@tue.ellis.eu"`, `strict_min_version: "121.0"`.
- [x] Icon generator: dependency-free PNG writer (zlib deflate, 4× supersampled book glyph on blue tile), deterministic output.
- [x] build.mjs: esbuild IIFE bundles content/options/popup (sourcemap off, minify off, target chrome121+firefox121), copy manifest/html/css/icons, `--zip` makes `artifacts/github-docs-tab-{chrome,firefox}-vX.zip`.
- [x] Commit.

### Task 2–8: Pure modules (TDD each: write tests → red → implement → green → commit)

**Task 2 `src/common/paths.js`** — `tests/paths.test.mjs`
Produces: `normalizePath(p)->string|null`, `resolveRelative(fromFile, href)->string|null`, `dirname`, `basename`, `stripExt`, `extname`, `isMarkdownPath`, `splitAnchor(href)->{path,anchor}`, `encodePath` (segment-wise encodeURIComponent).
Tests: `../` escape → null; `./a/../b.md` from `docs/x.md` → `docs/b.md`; anchor split `a.md#sec`; markdown ext matrix incl `.MD`, `.mdx`; encode spaces/#/%.

**Task 3 `src/common/slugger.js`** — `tests/slugger.test.mjs`
Produces: `githubSlug(text)`, `createSlugger()->{slug(text)}` (dedupe `-1`, `-2`).
Tests: `"Hello World!"→hello-world`; punctuation strip; underscores kept; unicode letters kept (`Überblick→überblick`); emoji stripped; duplicate → `x`, `x-1`, `x-2`; leading digits kept.

**Task 4 `src/common/frontmatter.js`** — `tests/frontmatter.test.mjs`
Produces: `parseFrontmatter(src)->{data|null, content, raw|null}`, `normalizeTags(data)->string[]`, `docTitle(data, fallback)`.
Handles: BOM/CRLF, quoted scalars, numbers/bools/null, inline `[a, b]`, dash lists, one-level nested maps (2-space indent), `#` comments, unterminated fence → treated as content.
Tests: each of the above + no-frontmatter passthrough + tags from `tags: a, b` string + `keywords` fallback + non-string title coerced.

**Task 5 `src/common/route.js`** — `tests/route.test.mjs`
Produces: `parseHash(hash)->{path?,heading?}|null`, `buildHash({path,heading})`.
Format: `#docs`, `#docs/<escaped path>`, optional `?h=<slug>`. Round-trip tests incl spaces, `#` in filename, plain `#readme` → null.

**Task 6 `src/common/docs-model.js`** — `tests/docs-model.test.mjs`
Produces: `collectDocs(entries, {folders, includeRootFiles, maxFiles})->{docs, truncated, total}`; `buildTree(docs)->NavNode` (`{name,path,isDir,children,doc?}`); `sortTree(root, metaByPath)`; `flattenTree(root)->DocFile[]`; `findNode(root,path)`; `prettifyName(filename)`.
Rules: root `*.md` iff includeRootFiles; folder segment match at any depth, case-insensitive; multi-segment patterns (`website/docs`) matched as consecutive segments; `.github` works; maxFiles cap sets truncated; non-blob entries ignored.
Sort: per level — README/index first, then `order`/`sidebar_position` (asc, missing=∞), then natural alpha (`2-x` < `10-x`), dirs interleaved by name.
Tests: monorepo `packages/a/docs/g.md` included; `src/util.md` excluded; cap; tree shape; sort orders; flatten order = display order.

**Task 7 `src/common/wikilinks.js`** — `tests/wikilinks.test.mjs`
Produces: `parseWikiTarget(inner)->{target,anchor,label}` (`[[T#A|L]]` forms), `buildResolver(docs, metaByPath)->{resolve(target, fromPath)->{path,anchor?}|null}`.
Priority: exact path (±ext) → basename (case/space/dash/underscore-insensitive) → frontmatter title → slug of title; ties: same-dir as `fromPath`, then shortest path.
Tests: each priority tier; ambiguity tie-breaks; anchor passthrough; unresolved → null.

**Task 8 `src/common/search.js`** — `tests/search.test.mjs`
Produces: `fuzzyScore(query,text)->number` (-Infinity = no match; bonuses: word-start, consecutive, exact-case; path-separator aware), `parseQuery(q)->{terms,phrases,tags}`, `searchFiles(docs, metaByPath, q)->[{doc,score,ranges}]`, `class ContentIndex` with `add(path,{text,title,headings,tags})`, `remove(path)`, `search(parsedQuery,{limit})->[{path,score,snippet,matchedIn}]`, `allTags()->Map<tag,count>`, `size`.
Tests: fuzzy ordering (`gsg` ranks `getting-started-guide.md` over `misc.md`), phrase match, AND semantics, `tag:x` filters, heading/title boost outranks body, snippet contains `<mark>`-range offsets, allTags counts.

**Task 9 `src/content/markdown.js` (+ `src/content/md-plugins.js`)** — `tests/markdown.test.mjs`
Produces: `createMarkdownIt(ctx)` (node-testable; ctx = `{resolveWikiLink(target)->{path,anchor}|null, classifyHref(href)->Classified, imageUrl(src)->string, slugger}`) and browser-only `renderDoc(md, source)->{html,toc,meta}` (frontmatter strip → markdown-it → DOMPurify → post-pass: table wrap, external `target=_blank rel=noopener`, copy-button hooks, checkbox disable).
Plugins: wikiLink inline rule (`[[…]]`, resolved/broken classes, `data-gdt-path`), GitHub alerts (`> [!NOTE|TIP|IMPORTANT|WARNING|CAUTION]` → styled aside w/ octicon), task lists, heading anchors (ids via slugger + permalink span, collect toc), fence highlight via hljs (`language-x` class, mermaid → labeled source block), footnotes via plugin.
`Classified` = `{type:'external'|'doc'|'dyn-doc'|'repo-file'|'anchor'|'plain', href, path?, anchor?}`.
Tests (createMarkdownIt only, no DOM): wikilink → `<a class="gdt-wikilink" data-gdt-path=…>`; broken wikilink class; alert html; task list checkbox html; heading id + toc entries; fence class + escaping; classify wiring for relative md link → `data-gdt-path`; image src rewritten via `imageUrl`.

### Task 10: Settings + GitHub client
**Files:** `src/common/browser.js`, `src/common/settings.js`, `src/content/github-api.js`; `tests/github-cache.test.mjs`
Produces: `ext` namespace shim; `DEFAULTS`/`loadSettings()/saveSettings(patch)/onSettingsChanged(cb)`; `makeClient({owner,repo,token})` → `{getTree()->{sha,entries,truncated,stale,fromCache}, getRawText(path,{sha}), getBlobObjectURL(path,sha), rateLimit}`; errors `RateLimitError`, `NotFoundError`; `clearAllCaches()`; pure `shouldRevalidate(entry, now, ttlMs)` + `mergeTruncatedTrees` (tested).
Cache: `storage.local` `gdt:tree:<owner>/<repo>` `{etag,sha,entries,fetchedAt}`; TTL 15 min; If-None-Match revalidate (304 free); 403-ratelimit → stale-if-available else RateLimitError; truncated → root listing + per-candidate-folder recursive subtree fetches merged.

### Task 11: UI (browser integration; verified by build + harness, not unit tests)
**Files:** `src/content/tab.js`, `src/content/viewer.js`, `src/content/search-ui.js`, `src/content/index.js`, `src/content/viewer.css`
- `tab.js`: `findRepoNav()`, `ensureTab({count,onClick})`, `setTabActive(active)` (demote/restore `aria-current` siblings).
- `viewer.js`: `createViewer({client,owner,repo,settings})` → `{open(route),navigate(route),close(),isOpen()}`. Hides `<main>` children (kept), mounts `#gdt-root`: header (breadcrumbs, search input, index progress, theme toggle, refresh, open/edit-on-GitHub), sidebar (tag chips, tree w/ expand state, count), article (frontmatter panel, rendered md, prev/next), right TOC rail w/ scrollspy. Background index build: concurrency-6 raw fetches ≤200 KB, feeds ContentIndex, progress %, re-sort tree once when done. Delegated click handling for internal links (`data-gdt-path`), dyn-doc on-demand load, copy buttons, heading permalink → `buildHash`, broken wikilinks → search. Error panels: rate-limit (suggest PAT), fetch retry.
- `search-ui.js`: dropdown panel under input; debounce 120 ms; groups Files/Content; keyboard ↑↓/Enter/Esc; `<mark>` highlights; tag: chips clickable.
- `index.js`: boot + `parseRepo(pathname)` guard, tree fetch → `ensureTab`, hash routing (open/close viewer), `turbo:load` + debounced MutationObserver re-injection, hashchange listener, theme sync from `html[data-color-mode]` MutationObserver.
- `viewer.css`: all `gdt-` scoped, GitHub CSS vars with fallbacks, forced light/dark palettes, hljs → prettylights var mapping, responsive (sidebar collapses <1012 px, TOC hides <1400 px), print styles.

### Task 12: Options + popup
**Files:** `src/options/options.{html,js,css}`, `src/popup/popup.{html,js,css}`
Options: PAT (password field + "Test" → `GET /user` shows login), folders textarea (one/line), maxFiles number, includeRootFiles/showBadge checkboxes, save/status/restore-defaults. Popup: token status dot, docs-folder summary, buttons Options / Clear cache / Help (README link).

### Task 13: Harness + e2e smoke (best-effort)
**Files:** `harness/harness.html`, `harness/harness-data.js`
Static page stubbing GitHub repo DOM (UnderlineNav, `<main>`), `chrome.storage` shim, fetch stub serving a fixture repo (nested docs, wiki links, frontmatter tags, alerts, code fences). Load `dist/content.js`. Verify via puppeteer MCP if reachable (tab appears, viewer opens, search finds, wikilink navigates); else document manual steps.

### Task 14: Docs + verification
**Files:** `README.md`, final `npm run build`
README: features, install (Chrome load-unpacked / Firefox about:debugging + store-zip note), PAT setup, options reference, hash-URL sharing, privacy (no telemetry, calls only GitHub), development (build/test/harness), limitations.
Verification (superpowers:verification-before-completion): `npm test` all pass; `npm run build` clean; `node --check` each dist bundle; manifest JSON parse; zips exist; harness smoke.
