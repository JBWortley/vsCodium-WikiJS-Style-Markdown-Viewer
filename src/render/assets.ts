import path from "node:path";
import type { AssetBases } from "./protocol";

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * Maps `/assets/x.png` (wiki-root based, as Wiki.js stores them) or `img/x.png` (page relative)
 * to a webview URI. Anything with a scheme, or resolving outside the wiki root, is left alone;
 * the webview's localResourceRoots would refuse it anyway.
 */
export function makeAssetResolver(bases: AssetBases, p: typeof path = path): (src: string) => string | undefined {
  return (src) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith("//") || src.startsWith("#")) return undefined;
    const clean = safeDecode(src.split(/[?#]/)[0]);
    if (!clean) return undefined;
    const target = clean.startsWith("/") ? p.join(bases.rootFsPath, clean) : p.resolve(bases.docDirFsPath, clean);
    const relative = p.relative(bases.rootFsPath, target);
    if (!relative || relative.startsWith("..") || p.isAbsolute(relative)) return undefined;
    return `${bases.rootUri}/${relative.split(p.sep).map(encodeURIComponent).join("/")}`;
  };
}
