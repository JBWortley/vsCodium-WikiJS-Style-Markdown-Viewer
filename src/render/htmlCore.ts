import { load, type CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import { uniqueHeadingId } from "./slug";
import { DEFAULT_LOCALE, absoluteHref, stripHost, wikiPathFromHref } from "./paths";
import { CLOBBERING_NAMES } from "./clobber";
import { highlightFence } from "./highlight";
import type { EditTarget } from "../editing/edits";

export interface HtmlCoreContext {
  /** Wiki.js "host" setting: links starting with it plus "/" become internal links. */
  siteUrl: string;
  /** Wiki path of the page being rendered, e.g. `how-to-guides/wiki/article-guidelines` or `home`. */
  pagePath: string;
  /** is-valid-page / is-invalid-page: exact page path (case-sensitive, like the Wiki.js database). */
  pageExists(pagePath: string): boolean;
  /** Viewer-only: maps a local image src to a loadable URI. Omitted in fidelity tests. */
  resolveAsset?(src: string): string | undefined;
}

export interface Heading {
  level: number;
  id: string;
  title: string;
}

export interface HtmlCoreResult {
  html: string;
  headings: Heading[];
}

const RESERVED = /^\/[a-z]\//i;
const RESERVED_EXACT = /^\/[a-z]$/i;

/**
 * Port of the Wiki.js 2.5.300 server pipeline after markdown-it: html-core (links, headings,
 * root text/table wrapping), its code-highlighter child, and the visible effects of
 * html-security (DOMPurify). The webview runs DOMPurify itself as a second, independent layer.
 */
export function processHtml(html: string, ctx: HtmlCoreContext, edits?: EditTarget[]): HtmlCoreResult {
  const $ = load(html, null, false);
  highlightCodeBlocks($);
  classifyLinks($, ctx);
  const headings = anchorHeadings($);
  wrapRootText($);
  wrapRootTables($);
  sanitize($);
  if (edits) {
    const blocks = new Set(edits.filter(t => t.kind !== "checkbox").map(t => t.id));
    const checks = new Set(edits.filter(t => t.kind === "checkbox").map(t => t.id));
    $("*").each((_, el) => {
      if (!blocks.has($(el).attr("data-wk-edit") ?? "")) $(el).removeAttr("data-wk-edit");
      if (!checks.has($(el).attr("data-wk-check") ?? "")) $(el).removeAttr("data-wk-check");
    });
  }
  if (ctx.resolveAsset) rewriteAssets($, ctx.resolveAsset);
  return { html: $.html(), headings };
}

/**
 * html-codehighlighter: every `pre > code` becomes a Prism block (line numbers, toolbar), not
 * only fenced code, e.g. indented code and raw `<pre><code>`. Fences are already final.
 */
function highlightCodeBlocks($: CheerioAPI): void {
  $("pre > code").each((_, code) => {
    const pre = $(code).parent();
    if (pre.hasClass("prismjs") || pre.parent().hasClass("code-toolbar")) return;
    const lang = /(?:^|\s)lang(?:uage)?-([\w-]+)/i.exec($(code).attr("class") ?? "")?.[1] ?? "";
    const highlighted = highlightFence($(code).text(), lang, pre.attr("data-line"));
    const edit = pre.attr("data-wk-edit");
    pre.replaceWith(edit ? highlighted.replace(/^(<\w+)/, `$1 data-wk-edit="${escapeAttr(edit)}"`) : highlighted);
  });
}

function classifyLinks($: CheerioAPI, ctx: HtmlCoreContext): void {
  $("a").each((_, elm) => {
    let href = $(elm).attr("href");
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
    href = stripHost(href, ctx.siteUrl);

    if (!href.includes("://")) {
      // Wiki.js intends to strip a trailing "/" here, but its `_.endsWith('/')` call never matches.
      if (RESERVED.test(href) || RESERVED_EXACT.test(href)) {
        $(elm).addClass("is-system-link");
      } else if (href.includes(".")) {
        $(elm).addClass("is-asset-link");
      } else {
        href = absoluteHref(href, ctx.pagePath);
        const target = wikiPathFromHref(href);
        if (!target) return; // Wiki.js bails out without touching the link
        $(elm).addClass("is-internal-link");
        const valid = target.locale === DEFAULT_LOCALE && ctx.pageExists(target.path);
        $(elm).addClass(valid ? "is-valid-page" : "is-invalid-page");
      }
    } else {
      $(elm).addClass("is-external-link");
    }
    $(elm).attr("href", href);
  });
}

function anchorHeadings($: CheerioAPI): Heading[] {
  const taken = new Set<string>();
  const headings: Heading[] = [];
  $("h1,h2,h3,h4,h5,h6").each((_, elm) => {
    const text = $(elm).text();
    const id = uniqueHeadingId(text, $(elm).attr("id"), taken);
    $(elm).attr("id", id).addClass("toc-header");
    $(elm).prepend(`<a class="toc-anchor" href="#${escapeAttr(id)}">&#xB6;</a> `);
    headings.push({ level: Number(elm.tagName.slice(1)), id, title: text.trim() });
  });
  return headings;
}

/** Wiki.js wraps stray root-level text (anything but a bare newline) in a div. */
function wrapRootText($: CheerioAPI): void {
  for (const node of $.root().contents().toArray()) {
    if (node.type === "text" && node.data !== "\n" && node.data !== "\r") $(node).wrap("<div></div>");
  }
}

/** Wiki.js wraps only tables that sit at the root of the page body. */
function wrapRootTables($: CheerioAPI): void {
  $.root()
    .children("table")
    .each((_, elm) => {
      $(elm).wrap('<div class="table-container"></div>');
    });
}

// Removed with their content. `style` too: the live page drops <style> (Vue strips it from
// templates). SVG/MathML animation and the mglyph/malignmark parser quirks are mXSS vectors.
// iframes stay: Wiki.js supports "Allow iframes" (the webview sandboxes them).
const REMOVE_WITH_CONTENT =
  "script,frame,frameset,object,embed,applet,base,meta,link,noscript,style,animate,set,animatemotion,animatetransform,mglyph,malignmark";
/** iframe attributes DOMPurify (with Wiki.js's ADD_ATTR "allow") leaves; e.g. allowfullscreen goes. */
const IFRAME_ATTRS = new Set(["src", "title", "width", "height", "style", "loading", "allow", "name", "id", "class", "align", "data-wk-edit"]);
const URI_ATTRS = new Set(["href", "src", "xlink:href", "action", "formaction", "background", "poster", "cite", "data", "srcset", "values", "to", "from", "by"]);
const DATA_URI_TAGS = new Set(["img", "audio", "video", "source", "image", "track"]);
// DOMPurify's default ALLOWED_URI_REGEXP and attribute whitespace stripping.
const ALLOWED_URI = /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;
const ATTR_WHITESPACE = /[\u0000-\u0020\u00A0\u1680\u180E\u2000-\u2029\u205F\u3000]/g;
const SAFE_ATTR_NAME = /^[a-z][a-z0-9_:.-]*$/i;

function sanitize($: CheerioAPI): void {
  $(REMOVE_WITH_CONTENT).remove();
  $("*").each((_, node) => {
    const elm = node as Element;
    // Pseudo-tags such as `<TODO: ...>` parse as elements with a ":" name; DOMPurify drops them.
    if (/[^a-z0-9-]/i.test(elm.tagName.replace(/^(svg|math):/i, ""))) {
      $(elm).replaceWith($(elm).contents());
      return;
    }
    for (const name of Object.keys(elm.attribs ?? {})) {
      const lower = name.toLowerCase();
      const iframeExtra = elm.tagName.toLowerCase() === "iframe" && !IFRAME_ATTRS.has(lower);
      if (!SAFE_ATTR_NAME.test(name) || lower.startsWith("on") || lower === "srcdoc" || iframeExtra) {
        $(elm).removeAttr(name);
        continue;
      }
      // DOMPurify trims every attribute value except `value`.
      const raw = elm.attribs[name];
      if (lower !== "value" && raw !== raw.trim()) $(elm).attr(name, raw.trim());
      const value = elm.attribs[name];
      if ((lower === "id" || lower === "name") && CLOBBERING_NAMES.has(value)) $(elm).removeAttr(name);
      else if (URI_ATTRS.has(lower) && !isAllowedUri(value, elm.tagName.toLowerCase(), lower)) $(elm).removeAttr(name);
    }
  });
}

export function isAllowedUri(value: string, tag: string, attr: string): boolean {
  const compact = value.replace(ATTR_WHITESPACE, "");
  if (compact === "") return true; // DOMPurify keeps empty values (href="")
  if (ALLOWED_URI.test(compact)) return true;
  return (attr === "src" || attr === "href" || attr === "xlink:href") && compact.startsWith("data:") && DATA_URI_TAGS.has(tag);
}

function rewriteAssets($: CheerioAPI, resolve: (src: string) => string | undefined): void {
  $("img[src], source[src], video[src], audio[src]").each((_, elm) => {
    const src = $(elm).attr("src");
    if (!src) return;
    const resolved = resolve(src);
    if (resolved) $(elm).attr("data-wiki-src", src).attr("src", resolved);
  });
}

function escapeAttr(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
