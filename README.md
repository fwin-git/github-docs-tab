# GitHub Docs Tab

A browser extension for **Chrome and Firefox** that adds a **Docs** tab to every GitHub repository — right next to Code, Issues, and Pull requests. It collects the repo's markdown documentation (root files plus `docs/`-style folders at any nesting depth) and renders it as a proper documentation site: file tree, cross-file and wiki links, live search, tags, and light/dark theming — without ever leaving `github.com`.

![Browsing the docs, switching files, and live search — captured from the real repo](media/demo.gif)

| Docs tab on the repo | Reading with sidebar & TOC | Live full-text search | Dark mode |
| --- | --- | --- | --- |
| ![Repository page with the injected Docs tab](media/01-docs-tab.png) | ![Reading a document with tree, pinned section and TOC](media/02-reading.png) | ![Search with highlighted snippets](media/03-search.png) | ![Forced dark theme](media/04-dark.png) |

## Quick start

```bash
npm install && npm run install-ext
```

The guided installer detects your browser and finishes in 2–3 clicks. Public repos work immediately; open any repository and click the **Docs** tab.

- **Just want to look?** `npm run install-ext -- --trial` launches a throwaway session with the extension pre-loaded — details in the **[Running a Trial](docs/trial.md)** guide.
- **Private repos / higher rate limit?** Add a GitHub token (a classic token with the `repo` scope is simplest) via the toolbar icon → **Options**. Full steps in **[Installation](docs/installation.md)** and **[Options](docs/options.md)**.

## Features

- **Docs tab** with a document count, injected into the repo nav and surviving GitHub's soft navigation.
- **Collects markdown** from root files and conventional folders (`docs`, `documentation`, `wiki`, `guides`, `.github`, `website/docs`, … — configurable) at any depth, so monorepos work.
- **Full GFM rendering**: tables, task lists, footnotes, GitHub alerts, syntax-highlighted code with copy buttons, heading anchors.
- **Linking**: relative links, images, and `[[wiki links]]` all resolve inside the viewer; external links open in a new tab.
- **Live search** (`/`): instant filename matching plus full-text search with `"phrases"` and `tag:` filters, highlighted snippets, and heading-deep jumps.
- **[Organization-wide search](docs/organization.md)**: index many repositories at once and search across all of them, grouped by repo.
- **[In-viewer editing](docs/editing.md)**: a live source+preview editor with drafts and one-click pull requests (or a downloadable patch).
- **[Deep links & sharing](docs/interface.md)**: viewer state lives in the URL; the chain-link button copies a link straight to the current document and heading.
- **[YAML frontmatter](docs/frontmatter.md)**: `title`, `description`, `tags`, `order`, and `pinned` drive titles, tag chips, ordering, and a pinned section.
- **[Persistent caching](docs/caching.md)**: contents are cached by git blob SHA, so unchanged files never re-download — even across restarts.
- **Light/dark** that follows GitHub's theme (with a manual override), and a title/filename toggle for the sidebar.

## Documentation

The [`docs/`](docs/) folder is the full documentation — and doubles as a live demo, since the extension renders it in its own Docs tab.

- **[Installation](docs/installation.md)** — Chrome, Firefox, guided, and permanent installs
- **[Running a Trial](docs/trial.md)** — a zero-click throwaway session
- **[Organization-wide Search](docs/organization.md)** — index and search many repos
- **[Editing & Publishing](docs/editing.md)** — the editor, drafts, and pull requests
- **[Interface & Shortcuts](docs/interface.md)** — icons, deep links, themes, keyboard
- **[Caching & Performance](docs/caching.md)** — how re-downloads are avoided; rate limits
- **[Frontmatter Reference](docs/frontmatter.md)** — every supported YAML property
- **[Options & Configuration](docs/options.md)** — settings, the popup, and token setup
- **[Development & Releases](docs/development.md)** — build, test, CI, and releases

## Privacy

No telemetry, no external services. The extension talks only to `api.github.com` and `raw.githubusercontent.com`, requests just the `storage` and `unlimitedStorage` permissions, runs only on `https://github.com/*`, and keeps everything in your browser's extension storage. All rendered markdown is sanitized with DOMPurify.

## Limitations

- github.com only (no GitHub Enterprise domains yet).
- Mermaid/KaTeX render as labeled source rather than diagrams.
- `.mdx` renders as plain markdown (JSX stripped) with a badge.
