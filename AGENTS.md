# AGENTS.md

Wiki.js-style Markdown viewer and block editor for VSCodium and VS Code.

## Workstation boundary

Never control keyboard, mouse, clipboard, window focus or peripherals, activate a visible
application, or run UI automation without express consent in the current conversation for
that exact action. Broad task authorization and full-auto mode do not override this rule.
Prefer background CLIs, APIs and headless checks. Ask before required interactive actions.

## Setup and rules

```sh
npm ci
npm run check
```

`npm run check` (typecheck, unit/golden tests and build) must pass before every commit.

1. Only explicit user Apply/checkbox actions may edit document buffers, through undoable
   WorkspaceEdit operations. Never serialize the rendered page back to Markdown or save a
   document implicitly. Validate source spans and document versions before applying edits.
2. Fidelity first. Prove renderer changes with fresh live golden captures. Do not silently
   improve Markdown output.
3. Keep `markdown-it` 11.0.1 and `markdown-it-attrs` 3.0.3 pinned. Rendering stays in the
   worker with its enforced timeout.
4. Retain the nonce CSP, `enableCommandUris: false`, both sanitizers and local-file opening
   through `vscode.open`, never `openExternal`.
5. Avoid new runtime dependencies; justify additions in the commit message.
6. Do not commit private captures, credentials, personal paths, customer examples or logs.
   Preserve third-party licenses and copyright notices.

## Fidelity and visual checks

Golden tests use `WIKI_VAULT`, `WIKI_SITE_URL` and captures in `.golden/` or `WIKI_GOLDEN_DIR`.
They skip when inputs are absent. Captures and exact-hash deviations stay outside tracked source.
See [docs/TESTING.md](docs/TESTING.md).

```sh
node scripts/snapshot.mjs --out snapshots --measure home guide/revisions
```

Snapshots use synthetic demo pages by default. Pass `--vault` and `--site-url` for another wiki.
Inspect headlessly; launching a visible browser needs express consent.

## Live test gate (required before any hand-off)

**Live tests take over keyboard, mouse, clipboard and window focus.** Obtain an explicit yes
for each specific run, stating what will run and how long. Approval does not carry over.
Batch changes so one run covers them. The opt-in flag is not a substitute for consent.

Both commands must pass, and their screenshots must be inspected before calling a build ready:

```sh
npm run livetest -- --app vscodium --allow-desktop-control
npm run livetest -- --app vscode --allow-desktop-control
```

Add a live step for each changed user-facing flow. Unit and golden tests cannot replace
editor integration, keybinding and actual webview checks.

Install only a gated build with `npm run deploy -- --to vscodium,vscode`. Installation does
not authorize restarting editors or passing `--launch`; those need separate express consent.
After installation, the user can restart each editor, open a page, choose **Wiki.js Page**
or press **Ctrl+Shift+V**, and compare with their live wiki.
