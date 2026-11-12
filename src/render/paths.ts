/**
 * Wiki.js path rules, ported from server/helpers/page.js (parsePath) and the link section of
 * server/modules/rendering/html-core/renderer.js (Wiki.js 2.5.300).
 */

const LOCALE_SEGMENT = /^[A-Z]{2}(-[A-Z]{2})?$/i;
// Not global in Wiki.js, so only the first unsafe character is removed.
const UNSAFE_CHARS = /[\x00-\x1f\x80-\x9f\\"|<>:*?]/;
/** The site's default locale (Wiki.js `lang.code`). */
export const DEFAULT_LOCALE = "en";

export interface WikiPath {
  locale: string;
  path: string;
}

/** Node's querystring.unescape: decodeURIComponent, falling back to the raw text. */
function qsUnescape(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * Exact port of Wiki.js `parsePath`. Throws (like the original) when nothing is left of the
 * path; html-core then leaves the link untouched.
 */
export function parseWikiPath(rawPath: string): WikiPath {
  let raw = qsUnescape(rawPath).trim();
  if (raw.startsWith("/")) raw = raw.substring(1);
  raw = raw.replace(UNSAFE_CHARS, "");
  if (raw === "") raw = "home";
  raw = raw.replace(/\\/g, "").replace(/\/\//g, "").replace(/\.\.+/gi, "");
  const parts = raw.split("/").filter((p) => p.trim() !== "" && p !== ".." && p !== ".");
  if (parts[0].length === 1) parts.shift(); // TypeError on empty parts, as in Wiki.js
  let locale = DEFAULT_LOCALE;
  if (LOCALE_SEGMENT.test(parts[0] ?? "")) locale = parts.shift() as string;
  return { locale, path: parts.join("/") };
}

/** html-core: `new URL("http://x" + href)` then parsePath(pathname). Resolves `.`/`..` segments. */
export function wikiPathFromHref(href: string): WikiPath | undefined {
  try {
    return parseWikiPath(new URL(`http://x${href}`).pathname);
  } catch {
    return undefined;
  }
}

/** Page key for a file under the wiki root: `about-drafting/x.md` -> `about-drafting/x` (case kept). */
export function pagePathFromRelativeFile(relativeFile: string): string {
  return relativeFile.replace(/\\/g, "/").replace(/\.md$/i, "") || "home";
}

export type LinkTarget =
  | { kind: "anchor"; id: string }
  | { kind: "page"; pagePath: string; hash?: string }
  | { kind: "asset"; relativePath: string; fromRoot: boolean }
  | { kind: "external"; url: string }
  | { kind: "ignored"; reason: string };

const OPENABLE_SCHEMES = /^(?:https?|mailto):/i;
const RESERVED = /^\/[a-z]\//i;
const RESERVED_EXACT = /^\/[a-z]$/i;

/** Wiki.js host stripping: only when the host is followed by "/" (`https://wiki.example.test/x`). */
export function stripHost(href: string, siteUrl: string): string {
  const host = siteUrl.replace(/\/+$/, "");
  return host && href.startsWith(`${host}/`) ? href.replace(host, "") : href;
}

/** Wiki.js's relative-link rule: children of the current page (or of the root for `home`). */
export function absoluteHref(href: string, currentPagePath: string): string {
  if (href.startsWith("/")) return href;
  return currentPagePath === "home" ? `/${href}` : `/${currentPagePath}/${href}`;
}

/**
 * Decides what a click on `href` in the preview should do, following the same classification
 * html-core applied when the page was rendered.
 */
export function classifyLinkTarget(rawHref: string, siteUrl: string, currentPagePath: string): LinkTarget {
  let href = rawHref.trim();
  if (!href) return { kind: "ignored", reason: "empty link" };
  if (href.startsWith("#")) return { kind: "anchor", id: qsUnescape(href.slice(1)) };
  href = stripHost(href, siteUrl);

  if (href.includes("://") || /^[a-z][a-z0-9+.-]*:/i.test(href)) {
    return OPENABLE_SCHEMES.test(href) ? { kind: "external", url: href } : { kind: "ignored", reason: `blocked scheme in ${href}` };
  }
  if (RESERVED.test(href) || RESERVED_EXACT.test(href)) return { kind: "ignored", reason: "Wiki.js system route" };

  const [pathPart, ...hashParts] = href.split("#");
  const hash = hashParts.length ? qsUnescape(hashParts.join("#")) : undefined;
  if (href.includes(".")) {
    const clean = qsUnescape(pathPart.split("?")[0]);
    // Obsidian-style links to other pages (`../x.md`): Wiki.js would treat them as assets, but
    // opening the page is more useful. Plain URL resolution clamps ".." at the root.
    if (/\.md$/i.test(clean)) {
      const base = currentPagePath.split("/").slice(0, -1).join("/");
      const resolved = qsUnescape(new URL(clean, `http://x/${base ? `${base}/` : ""}`).pathname);
      return { kind: "page", pagePath: resolved.replace(/^\/+/, "").replace(/\.md$/i, "") || "home", hash };
    }
    return { kind: "asset", relativePath: clean.replace(/^\/+/, ""), fromRoot: clean.startsWith("/") };
  }
  const parsed = wikiPathFromHref(absoluteHref(pathPart, currentPagePath));
  if (!parsed || !parsed.path) return { kind: "ignored", reason: "unparseable page link" };
  return { kind: "page", pagePath: parsed.path, hash };
}
