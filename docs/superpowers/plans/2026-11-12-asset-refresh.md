# Asset refresh implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement these tasks.

**Goal:** Saved local images (including SVGs) update in open Wiki.js views; manual refresh is discoverable.

**Architecture:** The worker reports resolved local asset paths. Each view watches its wiki root,
filters events to its dependencies, and debounces a render with a new resource cache key. Ordinary
Markdown edits keep stable asset URLs. A refresh command, title action and focused-view shortcut
use the same invalidation path. Existing DOM reconciliation preserves expanded details and scroll.

**Tech stack:** Existing TypeScript, VS Code API, worker renderer, Vitest and live editor suite.

**Spec:** User report: changing SVGs does not live-update and there is no easy refresh action.
Routine implementation choices: refresh saved local files; Ctrl+Shift+R / Cmd+Shift+R only in a focused Wiki.js
view; command palette refreshes the active view or previews of the current Markdown source.

## Constraints and review focus

- No new dependencies or changes to pinned Markdown rendering rules or safety boundaries.
- No source writes by the extension. Test asset writes are confined to disposable test directories.
- Preserve URI queries and SVG fragments; do not rewrite remote/data images.
- Watch create/change/delete, including atomic saves and missing assets; release obsolete watchers.
  A root watcher is necessary for newly created asset directories; only dependency events invalidate.
- Ignore unrelated files; dispose timers/watchers; prevent obsolete renders after navigation/closing.
- Manual refresh works in both view types and does not intercept terminal/text-editor shortcuts.
- Both editor live gates require fresh express consent, after all background validation and review.

## Task 1: Asset invalidation

- [x] Add failing resolver tests for versioned URLs, queries/fragments and dependency tracking.
- [x] Add watcher tests for change/create/delete, unrelated files, replacement and disposal.
- [x] Implement `AssetBases.cacheKey`, worker dependency reporting, and per-view asset watchers.
- [x] Keep the key stable during typing; advance it on asset changes and explicit refresh.
- [x] Verify `npm run check` and private golden comparisons without publishing captures.

## Task 2: Manual refresh and editor verification

- [x] Register `wikijsViewer.refresh` with title refresh icon and Ctrl+Shift+R / Cmd+Shift+R for Wiki.js views.
- [x] Add live checks for SVG changes on disk, missing-asset recovery, refresh shortcut/action,
      both view types, and retained reading position/details state.
- [x] Document saved-asset behavior and shortcut; increment patch version for installation.
- [x] Run background checks, independent code review and address material findings.
- [x] Obtain consent, pass both live editor gates and inspect screenshots.
- [x] Package/install the gated build without launching/restarting editors.
- [ ] Commit and publish.

## Review record

Independent review found one material issue: editor-title invocations pass a synthetic
`webview-panel:` resource for the side preview. Added a failing command-target regression,
resolved that resource to the singleton following preview, and covered inactive title groups.
Editor focus, watcher delivery, loaded image data and visual reading-state preservation remain
the responsibility of the explicit-consent live gate. No other material findings were reported.

The final shortcut is Ctrl+Shift+R / Cmd+Shift+R, handled inside the preview document. This avoids
the development host's Ctrl+R reload handler. The live tests establish actual webview focus before
using the shortcut and verify loaded image dimensions, changed resource URLs and reading position.
Headless tests also cover shortcut handling and leave text fields and unrelated shortcuts alone.

Final validation: 55 public tests passed; 12 private golden comparisons passed. VSCodium and
VS Code live gates passed, including asset replacement, missing directories, both refresh actions
and unchanged source files. All 32 screenshots were inspected. Installed 0.3.1 into both editors;
the packaged JavaScript hashes match the live-tested bundles. No editor restart was performed.
