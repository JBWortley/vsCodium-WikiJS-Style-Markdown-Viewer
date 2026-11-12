# Security

The extension renders local Markdown without saving it. Rendering runs in a worker with a
five-second timeout and a two-million-character source limit. Both host and webview sanitize
HTML. A nonce CSP and disabled command URIs provide additional defenses. Local files open
inside the editor. Remote images and HTTPS embeds can contact their hosts.

## Known dependency limitations

`markdown-it` 11.0.1, its `linkify-it` dependency and `markdown-it-attrs` 3.0.3 remain
pinned for Wiki.js compatibility. `npm audit` reports denial-of-service advisories in that
chain. The deadline and input limit reduce exposure; they are not dependency fixes.
Do not use the standalone snapshot CLI on untrusted Markdown: it does not apply the
extension host's worker timeout.

The packaging tool also currently reports a moderate `minimatch` glob-processing advisory.
Packaging operates on the local checkout and is not included in the runtime extension.

Do not run `npm audit fix --force` without reviewing rendering changes. Renderer upgrades
require fresh live golden captures. Development tools are separate from shipped bundles.

## Reports

Keep private wiki content, credentials and personal paths out of public issues. For ordinary
bugs, provide a minimal synthetic example and editor/version details. If GitHub private
vulnerability reporting is available on the repository's Security tab, use it for sensitive
security reports rather than public issues.
