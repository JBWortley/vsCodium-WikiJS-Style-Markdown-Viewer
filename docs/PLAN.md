# Architecture

The extension adds a Wiki.js Page custom editor and a side preview that follows the
active Markdown text editor. It renders the page body and frontmatter, without website chrome.

## Renderer

`src/render/markdown.ts` configures markdown-it and compatible plugins. `frontmatter.ts`
separates YAML metadata while preserving source line offsets. `htmlCore.ts`, `paths.ts`,
`slug.ts` and `highlight.ts` implement heading anchors, link classification, table wrappers
and highlighted code. `page.ts` combines them; `shell.ts` renders the page and metadata table.

`markdown-it` 11.0.1 and `markdown-it-attrs` 3.0.3 are deliberate fidelity pins. Upgrades
require fresh comparisons against a configured Wiki.js installation. Modules and settings
vary between sites, so exact parity with every Wiki.js deployment is not promised.

## Host and webview

`src/extension.ts` registers commands, bindings and the custom editor. `preview/panel.ts`
owns views, resource mapping, render debounce and messages. `wikiRoot.ts` detects roots
and indexes local pages. `renderService.ts` serializes requests to a worker, enforces a
five-second deadline and restarts timed-out workers. The host caps input at two million characters.

`webview/preview.ts` updates the DOM, preserves scroll/details state and handles links, copy
and scroll sync. `sanitize.ts` applies DOMPurify with the browser parser and inserts DOM
nodes without another serialization pass.

`render/editMap.ts` optionally annotates rendered blocks with unpredictable edit IDs and exact
source spans. `editing/edits.ts` validates document identity, version, source and YAML before
`panel.ts` applies a targeted WorkspaceEdit. `webview/editing.ts` manages per-block Apply/Cancel,
checkbox toggles and local drafts. Rendering without edit metadata retains the fidelity output.
This uses the [custom text editor document model](https://code.visualstudio.com/api/extension-guides/custom-editors#custom-text-editor)
for native document history and Save.

## Safety and validation

Only explicit editing actions change document buffers. Normal Save/autosave controls persistence.
The nonce CSP and both sanitizers provide
separate defenses. Command URIs are disabled. Local links use `vscode.open`; local resources
are limited to the wiki root and media directory. HTTPS iframes are sandboxed.

Unit tests cover rendering and path handling. Optional golden comparisons preserve meaningful
code whitespace and non-breaking spaces; exact-hash exceptions stay with private captures.
Synthetic pages support screenshots and live editor tests without private data.
See [TESTING.md](TESTING.md) for the consent-based live gate.

esbuild creates host, worker and webview bundles and third-party notices. The VSIX allowlist
includes only bundles, media, package metadata, README and licenses.
