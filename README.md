# GitHub Docs Tab

A browser extension for **Chrome and Firefox** that adds a **Docs** tab to every GitHub repository — right next to Code, Issues, and Pull requests. It collects the repo's markdown documentation (root files plus `docs/`-style folders at any nesting depth) and presents it as a proper documentation site: file tree, rendered markdown, cross-file links, wiki links, live search, tags, and light/dark theming — without ever leaving `github.com` or clicking through the file browser.

## Features

- **Docs tab with document count** injected into the repository navigation, shown whenever the repo contains markdown docs. Survives GitHub's soft (Turbo) navigation.
- **Documentation collection** from root markdown files (`README.md`, `CONTRIBUTING.md`, …) and conventional folders (`docs`, `doc`, `documentation`, `wiki`, `guides`, `handbook`, `manual`, `.github`, `website/docs` — configurable), matched at any depth, so monorepos (`packages/x/docs/…`) work.
- **Full markdown rendering** (GFM): tables, task lists, footnotes, autolinks, GitHub alerts (`> [!NOTE]` …), syntax-highlighted code fences with copy buttons, GitHub-style heading anchors with hover permalinks, mermaid fences shown as labeled source.
- **Linking between files**: relative links (`./other.md`, `../a/b.md#section`) navigate inside the viewer; links to markdown outside the collection load on demand; links to other repo files go to GitHub; external links open in a new tab. Images resolve to raw content automatically.
- **Wiki links**: `[[Page]]`, `[[Page|Label]]`, `[[Page#Heading]]`, `[[Page#Heading|Label]]`, `[[#Same-file heading]]`. Resolution by path → basename (case/space/dash/underscore-insensitive) → frontmatter title, preferring same-folder matches. Broken wiki links are styled distinctly and open search.
- **Live search** (`/` to focus): instant filename fuzzy matching plus full-text search once the background index finishes (progress shown). Supports `"exact phrases"` and `tag:x` filters; results show highlighted snippets and jump to matched headings.
- **YAML frontmatter support**: `title` (used in sidebar/breadcrumbs), `description`, `tags`/`keywords`/`categories` (clickable chips + `tag:` search), `order`/`sidebar_position` (sidebar ordering), `pinned: true`/`pin: true` (pinned section at the top of the sidebar), plus a collapsible metadata panel for everything else. Frontmatter is never rendered as raw text.
- **Sidebar**: file tree with folder icons and collapsible directories, a live filter field, pinned docs section, tag chips, and document count. README/index files sort first, then frontmatter order, then natural sort.
- **Title mode toggle** (H/file icon next to refresh): show each document as its **title** — YAML frontmatter `title:` first; otherwise the first highest headline (an h1 anywhere in the file wins; if there is no h1, the first h2, and so on); otherwise the filename — or as its plain **filename**. The choice persists.
- **Reading aids**: "On this page" table of contents with scroll-spy, breadcrumbs, previous/next navigation, reading-position deep links.
- **Light/dark mode**: follows GitHub's active theme automatically (including dim variants) via GitHub's CSS variables, with a manual auto → light → dark override.
- **Shareable URLs**: viewer state lives in the fragment — `https://github.com/owner/repo#docs/docs/guide.md?h=install` reloads and shares cleanly (people without the extension simply see the repo).
- **Private repos & rate limits**: works anonymously on public repos (60 API requests/hour, softened by ETag caching — 304 revalidations are free). Add a personal access token in Options for 5,000/hour and private repositories.

## Installation

### Guided install (recommended)

```bash
npm install && npm run install-ext
```

The installer builds the extension if needed, detects your browsers (Chrome, Brave, Edge, Chromium, Firefox on macOS/Linux/Windows), and offers two modes:

- **Guided install** — opens the browser's extensions page with the exact path already in your clipboard; you finish with 2–3 clicks (browsers intentionally provide no deep link that installs an unpacked extension, so those clicks are irreducible). Persists across restarts in Chromium-family browsers.
- **Quick trial** — zero clicks: launches a throwaway browser session with the extension already loaded (`--load-extension` for Chromium-family, Mozilla's `web-ext run` for Firefox). Note: branded Google Chrome ≥137 ignores `--load-extension`; trials work best in Brave/Edge/Chromium, and the guided install works everywhere.

Non-interactive: `npm run install-ext -- --browser firefox --trial`, `--list`, `--dry-run`.

### Running a trial

A trial is the fastest way to see the extension working — nothing is installed into your daily browser profile:

```bash
npm run install-ext -- --trial                    # prompts for the browser
npm run install-ext -- --browser brave --trial    # Chromium-family: instant
npm run install-ext -- --browser firefox --trial  # via `npx web-ext run`
```

What happens:

1. **Chromium-family (Brave/Edge/Chromium/Chrome):** a separate browser window opens using a throwaway profile in your temp directory, launched with `--load-extension=dist`. Visit any GitHub repository — the Docs tab is already there. Close the window and the profile is inert; your normal profile is untouched.
2. **Firefox:** the CLI runs Mozilla's `web-ext run` (fetched on first use via `npx`), which starts a fresh Firefox profile with the extension pre-loaded and live-reloads it when `dist/` changes. Keep the terminal open; `Ctrl+C` ends the session.

Caveats: branded Google Chrome ≥137 ignores `--load-extension` — if the Docs tab doesn't appear there, use Brave/Edge/Chromium for the trial or the guided install (which works in every Chrome). Firefox trials are session-scoped by design; the guided install's temporary add-on lasts until Firefox restarts, and a permanent Firefox install requires a signed zip from [addons.mozilla.org](https://addons.mozilla.org/developers/).

### Manual: Chrome (and Chromium/Edge/Brave)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select the `dist/` folder
   (or drag `artifacts/github-docs-tab-chrome-v*.zip` onto the page)

### Manual: Firefox

Temporary install (for testing):

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…** and select `dist/manifest.json`

Permanent installs require a signed build: submit `artifacts/github-docs-tab-firefox-v*.zip` to [addons.mozilla.org](https://addons.mozilla.org/developers/) (unlisted self-distribution works too). Firefox ≥ 121.

## Usage

- Visit any GitHub repository. If it has markdown docs, a **Docs** tab appears with a count badge.
- Click it (or open `…#docs` directly). The URL tracks the current document and heading, so links are shareable.
- Press `/` to search. Use `tag:guide`, `"exact phrase"`, or plain terms. `Esc` closes.
- Use the sidebar filter field to narrow the file tree as you type.
- Pin important docs to the top of the sidebar with `pinned: true` in their frontmatter.
- The circle icon toggles auto/light/dark theme; the arrows icon refreshes the doc list; GitHub/pencil icons open or edit the current file on GitHub.

## Frontmatter reference

All properties are optional; docs without frontmatter work fine. Recognized keys:

| Property | Type | Effect |
| --- | --- | --- |
| `title` | string | Document title: shown in the sidebar tree, pinned section, breadcrumbs, prev/next links, search results, and the browser tab. Takes priority over the headline-derived title; also resolves `[[wiki links]]`. |
| `description` | string | Shown under the title at the top of the document. |
| `tags` | array or comma string | Clickable chips (in the sidebar and on the doc) that run `tag:` searches; `tag:x` also filters search results. `keywords` and `categories` are accepted as aliases and merged. |
| `order` | number | Sort position within its folder (ascending; `sidebar_position` is a Docusaurus-compatible alias). README/index files always sort first; docs without an order follow, sorted naturally. |
| `pinned` | `true` / `"yes"` / `"1"` | Puts the doc in the highlighted **Pinned** section stuck to the top of the sidebar. `pin` is an alias. |

Anything else (`author`, `date`, custom keys, …) appears in the collapsible **Metadata** panel at the top of the document. Frontmatter is never rendered as raw text.

Example:

```yaml
---
title: Getting Started
description: How to get going quickly.
tags: [guide, intro]
order: 1
pinned: true
---
```

Parser note: the built-in YAML subset covers scalars (strings, numbers, booleans, null), quoted strings, inline arrays (`[a, b]`), dash lists, comments, and simple nested maps — the constructs that appear in real docs frontmatter. Exotic YAML (anchors, multi-line block scalars) is tolerated but shown as plain text in the metadata panel.

## Editing documents

The pencil button in the viewer's toolbar opens a **live editor**: markdown source on the left, an instantly updating preview on the right — rendered by exactly the same pipeline as the viewer (wiki links, alerts, highlighting, all of it) — plus a formatting toolbar (bold/italic/code/headings/lists/tasks/links/wiki links). It is deliberately a source editor with live preview rather than contentEditable WYSIWYG: HTML→markdown round-trips corrupt formatting and produce noisy diffs, which matters when the output becomes a commit.

Saving is always an explicit, confirmed step, with three routes:

1. **Propose via GitHub editor** — no token needed. Your edit is stashed locally and the extension navigates to GitHub's own file editor (`/edit/…`), where it pre-fills your changes; you review and press GitHub's native **Commit changes…** button, so the commit/branch/fork/PR flow runs entirely through GitHub's UI under your logged-in account. (The extension cannot — and should not — commit directly with your browser session: those endpoints are CSRF-protected by design.) If auto-fill fails on a GitHub editor redesign, a toast offers your edited content for one-click copy.
2. **Create pull request…** — fully automatic, requires an API token (options) with *Contents* and *Pull requests* write permission. Creates a branch from the default branch, commits the single-file change, and opens a PR — using your fork automatically when you lack push access. You get the PR link when it's done.
3. **Download .patch / Copy patch** — no auth at all. A standard unified diff (`git apply file.patch` or `patch -p1 < file.patch`), generated locally.

## Options

Click the extension icon → **Options**:

| Setting | Default | Notes |
| --- | --- | --- |
| Access token | — | Fine-grained token with read-only *Contents* is enough. Stored in local extension storage, sent only to `api.github.com`. |
| Documentation folders | `docs, doc, documentation, wiki, guides, guide, handbook, manual, .github, website/docs` | One per line; matched case-insensitively at any depth; `a/b` patterns match consecutive segments. |
| Include root markdown files | on | README, CONTRIBUTING, etc. |
| Docs tab count badge | on | |
| Maximum documents | 500 | Larger repos show a truncation notice. |
| Content-index size limit | 200 KB/file | Larger files are skipped by full-text search (still viewable). |

## Privacy

No telemetry, no external services. The extension talks exclusively to `api.github.com` and `raw.githubusercontent.com`, requests only the `storage` permission, runs only on `https://github.com/*`, and stores settings/caches in your browser's extension storage. All rendered markdown is sanitized with DOMPurify before insertion.

## Development

```bash
npm install
npm test           # unit tests (node:test) for all pure logic
npm run build      # bundle to dist/
npm run zip        # build + store zips in artifacts/
npm run watch      # rebuild bundles on change
npm run icons      # regenerate icons (deterministic, dependency-free)
node harness/serve.mjs   # http://localhost:8631/acme/widget — fixture repo page
```

The harness serves a fake GitHub repo page with stubbed `chrome.storage` and GitHub APIs, so the full content script can be exercised in a plain browser tab (no extension install needed).

Architecture notes live in `docs/superpowers/specs/`, the implementation plan in `docs/superpowers/plans/`. Pure logic (path resolution, frontmatter, slugs, docs collection, wiki-link resolution, search, markdown plugins, cache policy) is in ESM modules under `src/common/` + `src/content/` and covered by tests; browser integration (tab injection, viewer, routing) is verified through the harness.

## Limitations

- GitHub Enterprise domains are not yet supported (github.com only).
- Mermaid/KaTeX render as labeled source rather than diagrams (keeps the bundle lean).
- `.mdx` files render as plain markdown (JSX stripped by sanitization) with a badge.
- Repos readable only with SSO-gated tokens follow whatever access the token grants.
