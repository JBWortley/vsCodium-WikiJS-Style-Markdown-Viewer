/**
 * Port of `uslug` (the slugger Wiki.js 2 uses for heading ids).
 *
 * uslug walks UTF-16 code units, keeps Unicode letters (L), numbers (N) and marks (M), plus
 * `-_~`, turns separators (Z) into spaces, and drops everything else. Because it walks code
 * units, astral characters such as emoji (surrogate pairs) are dropped, while a following
 * U+FE0F variation selector (a mark) survives. Live proof: "🗺️ Where to Make" became
 * "️-where-to-make".
 */
const KEEP = /[\p{L}\p{N}\p{M}]/u;
const SEPARATOR = /\p{Z}/u;
const ALLOWED = "-_~";

export function uslug(input: string): string {
  const chars = input.normalize("NFKC");
  let out = "";
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const code = c.charCodeAt(0);
    // CJK unified ideographs and Hangul syllables are always kept.
    if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0xac00 && code <= 0xd7a3)) {
      out += c;
      continue;
    }
    // Japanese ideographic punctuation adds a space and, as in uslug, still falls through.
    if ((code >= 0x3000 && code <= 0x3002) || (code >= 0xff01 && code <= 0xff02)) out += " ";
    if (ALLOWED.includes(c)) {
      out += c;
      continue;
    }
    // A lone surrogate never matches L/N/M, which reproduces uslug's emoji dropping.
    if (KEEP.test(c)) out += c;
    else if (SEPARATOR.test(c)) out += " ";
  }
  // uslug 1.0.4: trim, collapse whitespace, then every run of spaces and hyphens becomes one "-"
  // ("Ltd, NZ - Dossier" -> "ltd-nz-dossier").
  return out
    .replace(/^\s+|\s+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/[\s-]+/g, "-")
    .toLowerCase();
}

/** Wiki.js heading id: slug, `h-` prefix when it starts with a digit, `-1`, `-2`... when taken. */
export function uniqueHeadingId(text: string, customId: string | undefined, taken: Set<string>): string {
  let slug = customId || uslug(text);
  if (/^\d/.test(slug)) slug = `h-${slug}`;
  if (taken.has(slug)) {
    let n = 1;
    while (taken.has(`${slug}-${n}`)) n++;
    slug = `${slug}-${n}`;
  }
  taken.add(slug);
  return slug;
}
