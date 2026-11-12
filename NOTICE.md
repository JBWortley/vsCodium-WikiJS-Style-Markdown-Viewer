# Notices

This extension is distributed under the GNU Affero General Public License, version 3 only
(`AGPL-3.0-only`). See [LICENSE](LICENSE). It is provided without warranty.

## Wiki.js-derived work

Wiki.js is copyright Requarks and its contributors, licensed under AGPL-3.0.
Source and license: https://github.com/requarks/wiki/tree/v2.5.300

`media/wiki.css` adapts the Wiki.js 2 default theme's selector structure and values.
The heading slug, link classification, HTML transformation and highlighting rules under
`src/render/` are adapted from or reproduce the Wiki.js 2.5.300 rendering pipeline.
These adaptations were modified for a local, read-only editor webview, with separate
sanitization and resource handling. Public distribution prepared on 2026-11-12.

## Other components

- Vuetify 2 reset styles: copyright Vuetify contributors, MIT; `licenses/VUETIFY.txt`.
- Prism twilight, toolbar and line-numbers styles: copyright Prism contributors, MIT;
  `licenses/PRISM.txt`.
- Material Design Icons 5.8.55 paths: `licenses/MDI.txt`, `licenses/MDI-NOTICE.md` and
  `licenses/APACHE-2.0.txt` retain the distribution license, icon attribution and terms.
- `src/render/clobber.ts` lists DOM property names captured from jsdom 16.4, the DOM used
  by the reference Wiki.js server sanitizer.

Every production build generates `dist/THIRD-PARTY-NOTICES.txt` from esbuild's actual inputs
and bundled package licenses. It accompanies the VSIX. Third-party names and copyright
statements are preserved for attribution.
