import yaml from "js-yaml";

/** The page's frontmatter as shown at the top of the view: every field, in file order. */
export interface Frontmatter {
  /** Parsed fields, in file order, values as plain text (empty string for an empty value). */
  entries: { key: string; value: string; line: number }[];
  /** The block exactly as in the file, including the `---` lines. */
  raw: string;
  /** False when the block is not valid YAML; the view then shows `raw` as text. */
  valid: boolean;
}

export interface SplitPage {
  frontmatter?: Frontmatter;
  body: string;
  /** Number of source lines before `body` starts; added to markdown-it line maps. */
  bodyLineOffset: number;
}

// The body group is optional so an empty block (`---` directly followed by `---`) ends there
// instead of running on to the next `---` line in the page.
const FRONTMATTER = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)??---[ \t]*(?:\r?\n|$)/;

/** Splits Wiki.js YAML frontmatter from the page body. Never throws. */
export function splitFrontmatter(source: string): SplitPage {
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const match = FRONTMATTER.exec(text);
  if (!match) return { body: text, bodyLineOffset: 0 };

  const block = match[0];
  const bodyLineOffset = block.split("\n").length - (block.endsWith("\n") ? 1 : 0);
  return { frontmatter: parseFrontmatter(match[1] ?? "", block), body: text.slice(block.length), bodyLineOffset };
}

function parseFrontmatter(yamlText: string, raw: string): Frontmatter {
  const rawBlock = raw.replace(/\r?\n$/, "");
  let data: unknown;
  try {
    // JSON_SCHEMA keeps timestamps as strings and refuses YAML's exotic types.
    data = yaml.load(yamlText, { schema: yaml.JSON_SCHEMA });
  } catch {
    return { entries: [], raw: rawBlock, valid: false };
  }
  if (data === undefined || data === null) return { entries: [], raw: rawBlock, valid: true };
  if (typeof data !== "object" || Array.isArray(data)) return { entries: [], raw: rawBlock, valid: false };

  // Source line of each top-level key (1-based within the file: line 0 is the opening ---).
  const lines = yamlText.split(/\r?\n/);
  const lineOf = (key: string) => {
    const i = lines.findIndex((l) => l.startsWith(`${key}:`) || l.startsWith(`"${key}":`) || l.startsWith(`'${key}':`));
    return i >= 0 ? i + 1 : 0;
  };
  const entries = Object.entries(data as Record<string, unknown>).map(([key, value]) => ({ key, value: asText(value), line: lineOf(key) }));
  return { entries, raw: rawBlock, valid: true };
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(asText).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
