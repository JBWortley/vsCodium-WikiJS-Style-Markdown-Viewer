import type { RenderedPage } from "./page";

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * The page's frontmatter as a compact table (every field, file order, raw values). Invalid YAML is
 * shown as the raw `---` block instead, so nothing is hidden.
 */
export function renderFrontmatter(page: RenderedPage): string {
  const fm = page.frontmatter;
  if (!fm) return "";
  if (!fm.valid) return `<pre class="wk-frontmatter-raw" data-line="0">${esc(fm.raw)}</pre>`;
  if (!fm.entries.length) return "";
  const rows = fm.entries
    .map(
      (e) =>
        `<div class="wk-fm-row" data-line="${e.line}"><dt>${esc(e.key)}</dt><dd${e.value ? "" : ' class="wk-fm-empty"'}>${esc(e.value)}</dd></div>`,
    )
    .join("");
  return `<dl class="wk-frontmatter" data-line="0">${rows}</dl>`;
}

/**
 * The view: the frontmatter table, then the page body exactly as the wiki renders it. No site
 * chrome (header, breadcrumbs, sidebar): those are navigation aids of the website, not the page.
 * The body is filled into #wk-contents by the webview (through its sanitizer).
 */
export function renderApp(page: RenderedPage, contentHtml = ""): string {
  return (
    `<div class="v-application theme--dark wk-app"><main class="v-main"><div class="wk-container">` +
    `<div id="wk-frontmatter">${renderFrontmatter(page)}</div>` +
    `<div class="contents"><div id="wk-contents">${contentHtml}</div></div>` +
    `</div></main></div>`
  );
}
