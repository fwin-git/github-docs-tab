# GitHub Docs Tab — Browser Extension Design

**Date:** 2026-07-23
**Status:** Approved (autonomous mode — decisions documented in lieu of interactive review)

## Purpose

A Chrome + Firefox extension that adds a **"Docs" tab** to every GitHub repository's navigation (next to Code, Issues, Pull requests, …). The tab collects markdown files from conventional documentation locations (root files + `docs/`-style folders, arbitrarily nested) and presents them in a first-class documentation-site experience — file tree, rendered markdown, cross-file links, wiki links, live search, tags, light/dark theme — without ever leaving `github.com` or clicking through the file browser.

## Success criteria

1. Visiting any public repo on github.com shows a "Docs" tab (with doc count) whenever ≥1 markdown doc exists (README counts).
2. Clicking it opens an in-page viewer: sidebar tree, rendered markdown, TOC, search. URL becomes `…#docs/<path>` — reload- and share-safe.
3. Relative links and `[[wiki links]]` between docs navigate inside the viewer; images render; external links open in new tabs.
4. Live search over filenames (instant) and full content (indexed lazily with progress), including `tag:` filtering from YAML frontmatter.
5. Follows GitHub's active theme automatically (incl. dark/dim), with a manual override toggle.
6. Same artifact loads unpacked in Chrome ≥121 and Firefox ≥121; zips build for both stores.
7. Pure logic (frontmatter, slugs, path/link resolution, doc collection, search) covered by `node:test` unit tests.

## Architecture

**Manifest V3, no background script.** GitHub's `api.github.com` and `raw.githubusercontent.com` send `Access-Control-Allow-Origin: *`, so the content script fetches directly. This removes the only cross-browser MV3 divergence (service worker vs. event page). One `manifest.json` serves both browsers (`browser_specific_settings.gecko` is ignored by Chrome).

**Components** (ESM in `src/`, bundled by esbuild into flat IIFE files in `dist/`):

- `content/index.js` — entry: repo-page detection, tab injection, hash router, GitHub Turbo (soft-nav) lifecycle via events + MutationObserver.
- `content/github-api.js` — trees API (`GET /repos/:o/:r/git/trees/HEAD?recursive=1`) with ETag revalidation cached in `storage.local` (304s don't count against the 60/h unauthenticated limit); raw-content fetches; optional PAT auth for private repos and higher limits.
- `common/docs-model.js` — pure: filters the flat tree into the docs set, builds the nav tree, sorting (README/index first → frontmatter `order`/`sidebar_position` → natural alpha), flat prev/next order, wiki-link resolution index.
- `common/frontmatter.js` — pure, dependency-free YAML-lite parser (scalars, quoted strings, inline + dash lists, one-level nesting; tolerant of everything else).
- `common/slugger.js` — GitHub-compatible heading slugs with duplicate suffixing.
- `common/paths.js` — relative path resolution/normalization.
- `common/search.js` — pure: filename fuzzy scoring + full-text index (built lazily from fetched contents), `tag:` and quoted-phrase syntax, snippet extraction.
- `content/markdown.js` — markdown-it pipeline + custom plugins (wiki links, GitHub alerts/callouts, task lists, heading anchors, hljs fences) + DOMPurify sanitization + link/image classification & rewriting.
- `content/viewer.js`, `content/search-ui.js`, `content/tab.js`, `content/viewer.css` — UI.
- `options/` — PAT, docs-folder list, limits, toggles. `popup/` — status + shortcuts + cache clear.

**Dependencies (bundled):** markdown-it, markdown-it-footnote, dompurify, highlight.js (common languages). Dev: esbuild. Tests: built-in `node:test`.

## Key behaviors & decisions

### Repo detection and tab injection
A page is a repo page iff `nav[aria-label="Repository"]` exists (robust across GitHub redesigns; avoids path-blocklist fragility). Owner/repo parsed from `location.pathname`. The tab is an `<li>` appended to the UnderlineNav list, styled with GitHub's own classes + book octicon + counter badge. A MutationObserver re-injects after Turbo re-renders. The tab renders only after the tree fetch confirms ≥1 doc; count shown in badge.

### Docs collection
From the recursive git tree: include files with extensions `.md .mdx .markdown .mdown` that are (a) at repo root, or (b) under a configured docs folder **segment at any depth** (default: `docs, doc, documentation, wiki, guides, guide, handbook, manual, .github, website/docs`) — monorepo-friendly (`packages/x/docs/…` matches). Cap at 500 files (configurable) with a visible truncation banner. If the tree API reports `truncated`, fall back to shallow root listing + per-candidate-folder recursive fetches. `.mdx` renders as markdown with a badge.

### Routing
Viewer state lives in the URL fragment: `#docs` (index) / `#docs/<path>` / `#docs/<path>?h=<heading-slug>`. Fragments never trigger GitHub navigation, survive reloads (content script re-opens the viewer on load), and are shareable (users without the extension just see the repo). Opening the viewer hides `<main>`'s children (kept intact) and mounts our container; closing restores them. Clicking other repo tabs triggers Turbo navigation which clears the hash → viewer unmounts; a click fallback handles same-URL no-op visits.

### Markdown experience
GFM via markdown-it (tables, strikethrough, autolinks, `linkify`), plus: footnotes; task-list checkboxes; GitHub alerts (`> [!NOTE]` …); heading anchor ids + hover permalinks (GitHub slugger); fenced-code syntax highlighting (hljs mapped onto GitHub's prettylights CSS variables); copy-code buttons; mermaid fences shown as labeled source blocks (rendering deferred — keeps bundle lean). All output passes through DOMPurify (allowlist incl. `details/summary`, `kbd`, disabled checkboxes; `id` preserved for anchors) before insertion — mandatory, since we inject into the github.com origin.

**Link resolution** (at render time): external → new tab (`rel=noopener`); relative → resolved against current file dir, then: in-collection doc → `#docs/…`; repo markdown outside the collection → loaded on demand into the viewer; other repo file → GitHub blob URL; bare `#anchor` → in-page scroll. Images: relative sources → `raw.githubusercontent.com/<owner>/<repo>/<tree-sha>/<path>` (immutable); with a PAT, fetched to blob URLs so private repos work.

**Wiki links:** `[[Target]]`, `[[Target|Label]]`, `[[Target#Heading]]`, `[[Target#Heading|Label]]`. Resolution priority: exact path → basename (case-insensitive; spaces/dashes/underscores equivalent) → frontmatter title → slug; ties prefer the current file's folder, then shortest path. Unresolved links render styled-broken and open search.

### Frontmatter
`---` block parsed with the in-house YAML-lite parser. Recognized: `title` (replaces sidebar/breadcrumb label), `description`, `tags` (array or comma string), `order`/`sidebar_position` (sorting), `date`, `author(s)`. Full set shown in a collapsible metadata panel; tags render as clickable chips that run `tag:` searches. Raw frontmatter is never rendered as markdown.

### Search
Search field in the viewer header (`/` focuses, `Esc` closes). Filename fuzzy-match is instant from the tree. Content index builds in the background on first viewer open (concurrency-limited raw fetches, ≤200 KB/file, progress indicator; contents cached in memory keyed by blob sha). Query: terms AND-ed, `"exact phrase"`, `tag:x`. Results ranked (title/heading hits boosted) with highlighted snippets; grouped Files/Content; keyboard navigable.

### Theming
The viewer inherits GitHub's CSS custom properties (`--bgColor-*`, `--fgColor-*`, prettylights syntax vars) with hard-coded fallbacks, so auto mode matches any GitHub theme including dark-dim. Manual toggle (auto → light → dark) persisted; forced modes apply a scoped fallback palette.

### Settings & caching
`storage.local`: PAT (never sync'd), tree cache `{etag, sha, files, fetchedAt}` per repo (15-min freshness, then ETag revalidation), prefs (theme, folders, caps, toggles). Options page: PAT with live validation, folder list, max files, root-files toggle, badge toggle. Popup: token status, clear cache, open options.

### Error handling
Rate-limited (403 + `x-ratelimit-remaining: 0`) → tab still shown from cache if present; viewer shows an explanatory panel recommending a PAT. Empty/404 repos → no tab. Truncated trees → banner. Fetch failures per-file → inline retry UI. All GitHub-DOM queries null-guarded so markup drift degrades to "no tab" rather than page breakage.

## Approaches considered

1. **No-build vanilla JS** (ordered content_scripts sharing the isolated world, vendored UMD libs) — simplest, but hljs ships no UMD in npm, globals ordering is brittle, and logic wouldn't be import-testable.
2. **esbuild-bundled ESM** — tiny build step; same modules run in node tests and the browser; tree-shaken single artifact. **Chosen.**
3. **Extension framework (WXT/Plasmo + React)** — heavy toolchain for what is one content script; rejected (YAGNI).

Routing alternatives — virtual path via pushState (404 on reload), query param `?tab=docs` (Turbo interference) — rejected in favor of hash routing.

## Testing

- `node --test`: frontmatter edge cases; slugger vs. GitHub reference cases; path resolution; docs-set selection incl. nested folders & caps; tree building & ordering incl. prev/next; wiki-link resolution priorities & ambiguity; search scoring, tag filters, snippets; markdown plugin output (wiki links, alerts, task lists, anchor ids, fence classes) via markdown-it in node.
- Build verification: esbuild succeeds, `node --check` on bundles, manifest JSON valid, zips produced.
- Manual smoke checklist in README (load unpacked → visit repos incl. this one's fixtures).

## Out of scope (v1)

GitHub Enterprise domains (needs optional host permissions UI), mermaid/KaTeX rendering (bundle size), offline PWA-style caching of contents, annotation/notes features, GitHub wiki-tab ingestion.
