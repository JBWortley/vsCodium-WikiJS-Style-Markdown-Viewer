/**
 * Renders wiki pages to standalone HTML using the exact renderer, markup and stylesheet the
 * webview uses, for screenshots and layout measurement in a Chromium browser (same engine as the
 * VSCodium webview).
 *
 *   node scripts/snapshot.mjs --vault <root> --out <dir> [--measure] page/path [...]
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { renderPage } from "../src/render/page";
import { renderApp } from "../src/render/shell";
import { WIKI_DEFAULTS } from "../src/render/markdown";
import { makeAssetResolver } from "../src/render/assets";
import { scanPages } from "../src/preview/wikiRoot";

const MEASURE_SCRIPT = `<script>
addEventListener('load', () => {
  const top = document.querySelector('.contents').getBoundingClientRect().top;
  const rows = [...document.querySelectorAll('#wk-contents > *')].map(el => {
    const r = el.getBoundingClientRect();
    return [el.tagName.toLowerCase(), Math.round(r.top - top), Math.round(r.height), Math.round(r.width)];
  });
  const pre = document.createElement('pre');
  pre.id = 'wk-measure';
  pre.textContent = JSON.stringify(rows);
  document.body.appendChild(pre);
});
</script>`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args.splice(i, 2)[1] : undefined;
  };
  const vault = flag("--vault") ?? process.env.WIKI_VAULT ?? path.resolve(__dirname, "../test/fixtures/wiki");
  const siteUrl = flag("--site-url") ?? process.env.WIKI_SITE_URL ?? "";
  const out = flag("--out") ?? "snapshots";
  const measure = args.includes("--measure") ? (args.splice(args.indexOf("--measure"), 1), true) : false;
  const cssHref = pathToFileURL(path.resolve(__dirname, "..", "media", "wiki.css")).href;
  const pages = new Set(await scanPages(vault));
  fs.mkdirSync(out, { recursive: true });

  for (const pagePath of args) {
    const file = path.join(vault, `${pagePath}.md`);
    const rootUri = pathToFileURL(vault).href.replace(/\/+$/, "");
    const page = renderPage(fs.readFileSync(file, "utf8"), {
      siteUrl,
      pagePath,
      pageExists: (p) => pages.has(p),
      resolveAsset: makeAssetResolver({ rootFsPath: vault, rootUri, docDirFsPath: path.dirname(file) }),
      markdown: WIKI_DEFAULTS,
    });
    const html =
      `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><link rel="stylesheet" href="${cssHref}"></head>` +
      `<body>${renderApp(page, page.contentHtml)}${measure ? MEASURE_SCRIPT : ""}</body></html>`;
    const target = path.join(out, `${pagePath.split("/").join("__")}.html`);
    fs.writeFileSync(target, html);
    console.log(`${target}  (${page.renderMs} ms)`);
  }
}

void main();
