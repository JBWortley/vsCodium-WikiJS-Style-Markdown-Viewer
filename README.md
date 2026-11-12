# Wiki.js Style Markdown Viewer

A Markdown viewer and block editor for **VSCodium and Visual Studio Code**, styled after Wiki.js 2.
It renders local pages with callouts, heading anchors, tables, syntax highlighting and wiki
links. A compact table shows YAML frontmatter above the page body.

Edits update the document buffer with Undo support; normal Save/autosave controls disk writes.
No Wiki.js account or API key is needed.
This is an independent project, not an official Wiki.js or VSCodium extension.

## Build and install

Use Node.js **22.22.2+ (22.x), 24.15.0+ (24.x), or 26+**, and VSCodium / VS Code 1.90 or later.

```sh
npm ci
npm run check
npm run package
```

Install `dist/wikijs-page-viewer.vsix` through **Extensions: Install from VSIX...**.
This project is distributed as source; no Marketplace or Open VSX listing is implied.
Maintainers must complete the [live editor gate](docs/TESTING.md#live-editor-gate-windows)
before distributing a build. Open `test/fixtures/wiki/home.md` for a synthetic demo.

## Use

- **Ctrl+Shift+V** opens **Wiki.js Page**. From that view, the same shortcut opens the source
  beside it. On macOS use **Cmd+Shift+V**.
- **Ctrl+K V** opens a side preview that follows edits and editor scrolling. On macOS use
  **Cmd+K V**.
- Saved changes to local images (including SVGs), audio and video refresh automatically.
  Unsaved edits in an asset editor appear after saving. Remote resources are not watched.
- Click the **Refresh Wiki.js Page** title-bar button, use the command palette, or press
  **Ctrl+Shift+R** (**Cmd+Shift+R** on macOS) with the Wiki.js view focused to render again and reload
  local assets. Refresh keeps your scroll position and expanded details sections.
- The blue book icon, **Open as Wiki.js Page** command and **Reopen Editor With...** menu
  provide the same entry point. Wiki.js Page can be selected as the default Markdown editor.
- Wiki links open local pages; red links indicate missing local pages.
- Heading anchors jump within the page. Code blocks have a **Copy** button.
- File links open inside the editor. Web links use the editor's external-link handling.
- **Wiki.js: Show Viewer Log** shows the detected root and render timings.

## Edit in the page

- **Double-click text or a quote block** to edit its Markdown. **Shift-click an object** to
  edit its original HTML or Markdown, including image tags and SVG elements. Focus a block
  with Tab and press **F2** for keyboard access. HTML nested across quote/list lines opens its
  Markdown container so the surrounding prefixes remain intact.
- Use **Apply** / **Cancel** for each block (**Ctrl+Enter / Cmd+Enter** and **Esc** also work).
  Apply updates the document buffer; use normal Save to write it to disk. Autosave follows
  your editor settings. Undo/Redo work in the Markdown source and Wiki.js Page; for the side
  preview, use Undo/Redo in its source editor.
- Click Markdown task checkboxes or HTML checkboxes to update their source immediately.
- **Edit attributes** opens the YAML frontmatter while keeping the normal header compact.
  Invalid YAML is rejected and the draft is retained. Add/remove fields in the same editor.
- Embedded frames have an **Edit HTML** button because clicks inside them belong to the
  embedded website. Edited HTML still passes through both sanitizers.

Only the selected source span changes. Background renders preserve a draft; if the document
changes elsewhere, Apply rejects the stale edit. Cancel and reopen the block to use the latest
source. Unapplied drafts are local to their view and are not saved as document changes.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `wikijsViewer.wikiRoot` | Empty | Detect the nearest ancestor with `home.md`, then fall back to the workspace or page folder. An absolute path overrides detection. |
| `wikijsViewer.siteUrl` | Empty | Your wiki's base URL, e.g. `https://wiki.example.test`. Matching URLs become local wiki links. Without a value, absolute URLs remain external. |
| `wikijsViewer.useForPreviewShortcuts` | `true` | Use Wiki.js views for preview shortcuts. Turn off to retain built-in bindings. |
| `wikijsViewer.markdown.breaks` | `true` | Convert single line breaks to `<br>`. |
| `wikijsViewer.markdown.typographer` | `true` | Smart quotes and typographic replacements. |
| `wikijsViewer.markdown.linkify` | `true` | Turn bare URLs into links. |

Keep personal paths and private wiki addresses in local editor settings, outside this repository.

## Fidelity and limitations

The renderer follows the Wiki.js 2.5.300 pipeline. `markdown-it` 11.0.1 and
`markdown-it-attrs` 3.0.3 are pinned because newer versions change output. Optional golden
tests compare local pages against captured live HTML; private captures are not included.

- Dark page-body styling only; website navigation, sidebars and comments are omitted.
- Mermaid, KaTeX, PlantUML and Kroki are not rendered.
- Prism 1.30 can tokenize code differently from older Wiki.js installations.
- Emoji shortcodes produce Unicode rather than Twemoji images.
- Link validity follows local files, which can differ from published pages.
- Fonts and small layout differences depend on the browser and operating system.
- Remote images and sandboxed HTTPS iframes can contact their hosts. The viewer does not
  fetch wiki pages or upload Markdown. Non-HTTPS embeds show a placeholder.

## Development and security

`npm run check` runs typechecking, tests and the production build without opening an editor.
The [Windows live tests](docs/TESTING.md) operate the keyboard, mouse, clipboard and window
focus and need explicit consent for **each run**. They are separate from CI.

The preview uses a nonce CSP, disabled command URIs, a host sanitizer and webview DOMPurify.
Host messages are authenticated; embedded frames cannot invoke the preview's test controls.
Rendering runs in a worker with a five-second deadline and a two-million-character limit.
The pinned Markdown dependency chain still has denial-of-service advisories; the worker
boundary limits their impact but does not remove them. See [SECURITY.md](SECURITY.md).

See [testing](docs/TESTING.md), [architecture](docs/PLAN.md) and [contributor rules](AGENTS.md).

## License

[GNU AGPL v3 only](LICENSE). Wiki.js-derived rendering rules and styling are distributed under
that license. Third-party attribution is retained in [NOTICE.md](NOTICE.md), `licenses/`,
and the generated `dist/THIRD-PARTY-NOTICES.txt` included in each VSIX.
