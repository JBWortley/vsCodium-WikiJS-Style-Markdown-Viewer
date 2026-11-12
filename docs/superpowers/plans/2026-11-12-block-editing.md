# Editing in the Wiki.js page

## Design and decisions

The user requested text editing, Shift-click source/tag editing for objects, HTML editing,
checkboxes, quote blocks and the compact attributes at the top. They selected Apply/Cancel
per block; checkboxes update immediately with Undo. This request supersedes the earlier
read-only scope. Implementation choices below are the agent's decisions.

Double-click text or a quote to open its Markdown block in a compact inline editor. Shift-click
an object to edit its original HTML or Markdown. A small Edit attributes action opens the YAML
block; its normal display remains compact. Embedded frames get a separate Edit HTML action
because clicks inside a frame belong to its website. All editors offer Apply and Cancel.

Apply updates the document buffer through a VS Code WorkspaceEdit, supporting native Undo.
Normal Save/autosave controls persistence. Checkbox clicks replace only their source marker
(or the checked attribute for HTML checkboxes). No automatic whole-file serialization.

Alternatives considered: converting rendered HTML back to Markdown would lose source formatting;
a separate source tab would not provide the requested page editing. Per-block source editing
preserves Wiki.js extensions and gives explicit control of tags and attributes.

## Architecture and constraints

- Optional worker-generated edit metadata maps rendered elements to exact source spans. Default
  renderer output stays unchanged for fidelity tests. Renderer pins and timeout remain intact.
- Use unpredictable per-view edit IDs and a host-held snapshot. Never trust offsets sent by a
  webview. Validate document identity/version and the expected original span before applying.
- Drafts survive background asset/source refresh; reject conflicts visibly without losing text.
- Preserve BOM, line endings and surrounding content. Validate attributes as a YAML mapping.
- HTML drafts are textarea values. Existing CSP, disabled command URIs, local-link rules and
  both sanitizers remain active. No new runtime dependency.
- User-triggered edits only. Tests use disposable synthetic documents; private wiki files stay
  untouched. Desktop tests need separate, fresh explicit consent for each editor run.

## Implementation plan

1. [x] Source mapping and edit validation: meaningful failing tests for Markdown, quotes, nested
       HTML/SVG, checkboxes, attributes, CRLF/BOM, forged IDs and stale documents; implement.
2. [x] Host/document bridge: versioned render snapshot, targeted WorkspaceEdit, error feedback.
3. [x] Page UI: Apply/Cancel, double-click/Shift-click, checkbox interaction, attributes/frame
       actions, keyboard access and draft preservation; headless interaction tests.
4. [x] Documentation and live scenarios: each editing flow, cancel/conflict/Undo, both view kinds,
       source preservation and safety. Increment version; run full checks and golden comparisons.
5. [x] Independent review, address findings, obtain consent, pass both editor gates and inspect
       screenshots.
6. [x] Install the tested build and verify installed bundle hashes.

Publish the verified result as requested; Git history and the commit's GitHub Actions run
record publication and CI status.

## Progress

Refresh prerequisite: 0.3.1 installed in both editors and pushed as 8ea87fc; GitHub CI passed.
Work continues in the existing isolated worktree on feat/block-editing. Implementation is inline
because mapping, host lifecycle and page reconciliation are closely coupled.

Background validation: 66 tests pass, typecheck/build pass, 12 private golden comparisons pass.
One snapshot test timed out under parallel load; it passed alone and in the subsequent full run.
Independent review identified repeated inline HTML checkboxes and stripped list/quote prefixes.
Exact inline parser offsets, line mappings (including tabs), and regression tests resolve both;
scoped re-review found no remaining important issues. Multiline HTML spanning container prefixes
opens its Markdown container. Side-preview document history is available in its source editor;
Wiki.js Page uses native custom-text-editor history. No new runtime dependencies.

Both authorized live editor runs passed. VSCodium passed all 29 suite checks; VS Code passed
28 with one expected skip because that version has no built-in WYSIWYG Markdown Editor.
All 44 screenshots were inspected. Both runs used identical bundles. Editing checks covered
Apply/Cancel, native Undo, Markdown and HTML checkboxes, quotes, HTML objects, frontmatter,
embedded frames, stale drafts, both view types, explicit Save, and unchanged wiki files.

The final deployment reran the complete check (66 passed, one missing-private-input skip),
packaged 0.4.0, and installed it into both editors through their background CLIs. All four
installed JavaScript/CSS hashes match the live-tested bundles. No editor restart was performed.
