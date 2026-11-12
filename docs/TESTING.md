# Testing

## Background checks

```sh
npm ci
npm run check
```

These run without opening a desktop application. CI runs them on Windows and Linux.
Synthetic pages in `test/fixtures/wiki/` are not live Wiki.js captures or pixel-parity evidence.

## Private golden comparisons

Set `WIKI_VAULT` to your local wiki root and `WIKI_SITE_URL` to its website base URL.
Put actual captured `.contents` HTML in `.golden/`, or point `WIKI_GOLDEN_DIR` to a directory
outside this repository. Use filenames such as `guide__revisions.html` for `guide/revisions.md`.

Capture from the actual wiki via a read-only browser API. Never generate expected HTML with
this renderer. Run `npm test -- test/golden.test.ts`. Every unexplained block difference fails.
To document a verified upstream difference, place its exact normalized hash in local
`deviations.json` beside the captures:

```json
{
  "guide/revisions": [
    {
      "hash": "replace-with-exact-block-hash",
      "side": "live",
      "reason": "prism",
      "note": "Explain the verified difference"
    }
  ]
}
```

Do not add broad exceptions. Captures, exception notes and failure logs may contain private
data. Without a vault and captures the golden suite reports a skip.

## Standalone snapshots

```sh
npm run snapshot -- --out snapshots --measure home guide/revisions
```

Pass `--vault <path>` and `--site-url <URL>`, or set `WIKI_VAULT` and `WIKI_SITE_URL`,
to render another wiki. The default output directory `snapshots/` is ignored by Git.
Rendering HTML does not open a browser. Headless Chromium screenshots at 1048px wide
can support visual checks without taking desktop focus. Use trusted Markdown only:
the snapshot CLI does not use the extension host's worker deadline.

## Live editor gate (Windows)

Each run takes about three to four minutes and operates the keyboard, mouse, clipboard and focus.
Obtain explicit consent for that exact run before passing `--allow-desktop-control`.
Without the flag, the command exits before launching an editor.

```sh
npm run livetest -- --app vscodium --allow-desktop-control
npm run livetest -- --app vscode --allow-desktop-control
```

Both must pass, and all output screenshots must be inspected before handing off a build.
Set `CODIUM_EXE` or `CODE_EXE` for non-default executable locations. Tests use a temporary
profile and the synthetic wiki, revert typed changes and check source hashes.
`--vault` can select another copy of the demo with the same structure, not an arbitrary wiki.
Results go to a temporary directory or `--out`; keep them outside version control.

The suite covers editor switching, shortcuts, navigation, frontmatter, copy, live edits,
scrolling, HTTPS embeds and hostile HTML. Asset checks use disposable files outside the
workspace: SVG saves, atomic replacement, missing-directory creation and manual refresh in
both view types. They verify loaded image dimensions and retain scroll/expanded details.
Editing checks use a separate disposable document: text Apply/Cancel and keyboard Apply,
native Undo, Markdown/HTML checkboxes, quotes, Shift-click HTML, compact YAML attributes,
iframe editing, conflicting external changes, side-preview editing and explicit Save.
The original demo/private wiki files must remain byte-identical.
Unsupported editor features report SKIP.
Add a step for every user-facing flow you change.

After the gate, `npm run deploy -- --to vscodium,vscode` packages and installs through the
editors' CLIs. Override locations with `CODIUM_CLI` / `CODE_CLI`. Restarting or opening an
editor is a separate interactive action requiring separate consent.
