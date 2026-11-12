/**
 * Golden fidelity: render vault sources and compare with `.contents` HTML captured from the live
 * wiki (see docs/TESTING.md). Skipped when the captures or the vault are not on this machine.
 *
 * "Ours" is what the webview displays: the host renderer's output passed through the webview's
 * own DOMPurify layer (src/webview/sanitize.ts, on jsdom here).
 *
 * Both sides are parsed with the same HTML5 parser and normalized only for what the browser/Vue
 * change: whitespace-only text next to block elements, runs of ASCII whitespace outside <pre>,
 * attribute and class order, inline-style re-serialization, boolean attribute values, and the
 * viewer's own `data-line`, `data-wiki-src` and iframe `sandbox` attributes. Whitespace inside
 * <pre>/<textarea> and non-breaking spaces are compared exactly.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { load } from "cheerio";
import type { AnyNode } from "domhandler";
import { JSDOM } from "jsdom";
import createDOMPurify from "dompurify";
import { renderPage } from "../src/render/page";
import { WIKI_DEFAULTS } from "../src/render/markdown";
import { createSanitizer } from "../src/webview/sanitize";
import { buildPageIndex } from "./helpers/pageIndex";

const GOLDEN_DIR = path.resolve(process.env.WIKI_GOLDEN_DIR ?? path.join(__dirname, "../.golden"));
const VAULT = process.env.WIKI_VAULT ?? "";
const available = !!VAULT && fs.existsSync(GOLDEN_DIR) && fs.existsSync(path.join(VAULT, "home.md"));

/**
 * Blocks that legitimately differ, matched by the hash of the exact normalized block (so a
 * deviation can never excuse some other change). Reasons:
 * - unpublished: the linked page exists in the vault but not on the live wiki.
 * - prism: the site's Prism 1.22 emits fewer markdown url sub-tokens than 1.30 (same colours).
 * - drift: the vault copy was edited after the live page was last saved.
 */
type Deviation = { hash: string; side: "live" | "ours"; reason: string; note: string };
const deviationsFile = path.join(GOLDEN_DIR, "deviations.json");
const KNOWN_DEVIATIONS: Record<string, Deviation[]> = available && fs.existsSync(deviationsFile)
  ? JSON.parse(fs.readFileSync(deviationsFile, "utf8")) as Record<string, Deviation[]>
  : {};

const BLOCK = new Set(
  "address article aside blockquote br details dialog dd div dl dt figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr li main nav ol p pre section summary table tbody td tfoot th thead tr ul".split(" "),
);
const BOOLEAN_ATTRS = new Set(["disabled", "checked", "selected", "open", "hidden", "readonly", "multiple"]);
const VIEWER_ATTRS = new Set(["data-line", "data-wiki-src"]);
const ASCII_WS = /[ \t\n\r\f]+/g;

type DomNode = { type: string; name?: string; data?: string; prev: DomNode | null; next: DomNode | null; parent: DomNode | null };

function insidePre(node: DomNode): boolean {
  for (let p = node.parent; p; p = p.parent) if (p.name === "pre" || p.name === "textarea") return true;
  return false;
}

/** Whitespace-only text that touches a block element or a container edge never renders. */
function isIgnorableWhitespace(node: DomNode): boolean {
  if (node.type !== "text" || /[^ \t\n\r\f]/.test(node.data ?? "") || insidePre(node)) return false;
  const blockish = (n: DomNode | null) => !n || (n.type === "tag" && BLOCK.has(n.name ?? ""));
  return blockish(node.prev) || blockish(node.next);
}

/** The browser re-serializes inline styles (`margin: 0` becomes `margin: 0px`). */
function normalizeStyle(style: string): string {
  return style
    .split(";")
    .map((d) => d.trim().replace(ASCII_WS, " ").replace(/\b0px\b/g, "0").replace(/\s*:\s*/, ": "))
    .map((d) => (d.startsWith("transform-origin:") ? d.replace(/ 0$/, "") : d))
    .filter(Boolean)
    .join("; ");
}

function normalizeAttr(name: string, value: string): string {
  if (BOOLEAN_ATTRS.has(name)) return "";
  if (name === "class") return value.split(ASCII_WS).filter(Boolean).sort().join(" ");
  if (name === "style") return normalizeStyle(value);
  return value;
}

function serialize(node: AnyNode): string {
  const n = node as unknown as DomNode & { attribs: Record<string, string>; children: AnyNode[] };
  if (n.type === "text") {
    if (isIgnorableWhitespace(n)) return "";
    return insidePre(n) ? (n.data ?? "") : (n.data ?? "").replace(ASCII_WS, " ");
  }
  if (n.type !== "tag" && n.type !== "script" && n.type !== "style") return "";
  const attrs = Object.entries(n.attribs)
    .filter(([k]) => !VIEWER_ATTRS.has(k) && !(n.name === "iframe" && k === "sandbox"))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => ` ${k}="${normalizeAttr(k, v)}"`)
    .join("");
  const raw = n.children.map(serialize).join("");
  const inner = n.name === "pre" || n.name === "textarea" || insidePre(n) ? raw : raw.replace(ASCII_WS, " ");
  return `<${n.name}${attrs}>${inner}</${n.name}>`;
}

/** Top-level blocks of a content fragment, normalized. */
export function normalize(html: string): string[] {
  const $ = load(`<div id="root">${html}</div>`);
  return $("#root")
    .contents()
    .toArray()
    .map((child) => serialize(child).trim())
    .filter(Boolean);
}

const hashOf = (block: string) => crypto.createHash("sha256").update(block).digest("hex").slice(0, 16);

/** Longest-common-subsequence alignment, so one drifted block does not cascade. */
function alignBlocks(a: string[], b: string[]): { onlyLive: string[]; onlyOurs: string[] } {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const onlyLive: string[] = [];
  const onlyOurs: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) onlyLive.push(a[i++]);
    else onlyOurs.push(b[j++]);
  }
  onlyLive.push(...a.slice(i));
  onlyOurs.push(...b.slice(j));
  return { onlyLive, onlyOurs };
}

function liveBlocks(file: string): string[] {
  const $ = load(fs.readFileSync(file, "utf8"));
  return normalize($(".contents > div").html() ?? "");
}

/** What the webview shows: host HTML through the webview's DOMPurify layer. */
function displayed(html: string): string {
  const { window } = new JSDOM("<!DOCTYPE html><body></body>");
  const sanitize = createSanitizer(createDOMPurify(window as unknown as Window & typeof globalThis), window.document);
  const holder = window.document.createElement("div");
  holder.appendChild(sanitize(html));
  return holder.innerHTML;
}

describe.skipIf(!available)("golden fidelity vs live wiki", () => {
  const pages = available ? buildPageIndex(VAULT) : new Set<string>();
  const files = available ? fs.readdirSync(GOLDEN_DIR).filter((f) => f.endsWith(".html")) : [];

  if (!available) it.skip("set WIKI_VAULT and provide local captures to compare live HTML", () => {});

  for (const file of files) {
    const pagePath = file.replace(/\.html$/, "").split("__").join("/");
    it(pagePath, () => {
      const source = fs.readFileSync(path.join(VAULT, `${pagePath}.md`), "utf8");
      const rendered = renderPage(source, {
        siteUrl: process.env.WIKI_SITE_URL ?? "",
        pagePath,
        pageExists: (p) => pages.has(p),
        markdown: WIKI_DEFAULTS,
      });
      const live = liveBlocks(path.join(GOLDEN_DIR, file));
      const { onlyLive, onlyOurs } = alignBlocks(live, normalize(displayed(rendered.contentHtml)));
      const allowed = KNOWN_DEVIATIONS[pagePath] ?? [];
      const explained = (side: "live" | "ours", block: string) => allowed.some((d) => d.side === side && d.hash === hashOf(block));
      const unexplained = [
        ...onlyLive.filter((b) => !explained("live", b)).map((b) => `live ${hashOf(b)}: ${b.slice(0, 300)}`),
        ...onlyOurs.filter((b) => !explained("ours", b)).map((b) => `ours ${hashOf(b)}: ${b.slice(0, 300)}`),
      ];
      const identical = live.length - onlyLive.length;
      console.log(
        `[${pagePath}] ${identical}/${live.length} live blocks identical, ${onlyLive.length + onlyOurs.length - unexplained.length} known deviations` +
          (unexplained.length ? `, ${unexplained.length} UNEXPLAINED\n${unexplained.slice(0, 8).join("\n")}` : ""),
      );
      expect(unexplained).toEqual([]);
    });
  }
});
