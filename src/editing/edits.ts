import { splitFrontmatter } from "../render/frontmatter";

export interface EditTarget {
  id: string;
  kind: "markdown" | "html" | "frontmatter" | "checkbox";
  label: string;
  start: number;
  end: number;
  source: string;
  /** Exact replacement for a checkbox, calculated from the original source. */
  on?: string;
  off?: string;
  checked?: boolean;
}

export interface EditSnapshot {
  uri: string;
  version: number;
  source: string;
  targets: EditTarget[];
}
export interface EditRequest { id: string; text?: string; checked?: boolean }

/** Validate against the host's snapshot, never against offsets supplied by page HTML. */
export function prepareEdit(snapshot: EditSnapshot, current: Omit<EditSnapshot, "targets">, request: EditRequest): { start: number; end: number; text: string } {
  if (snapshot.uri !== current.uri || snapshot.version !== current.version || snapshot.source !== current.source) {
    throw new Error("The document changed. Your draft is kept; cancel and reopen this block to edit the current version.");
  }
  const target = snapshot.targets.find(t => t.id === request.id);
  if (!target || current.source.slice(target.start, target.end) !== target.source) throw new Error("This block is no longer available. Reopen it and try again.");
  let text: string;
  if (target.kind === "checkbox") {
    if (typeof request.checked !== "boolean" || target.on === undefined || target.off === undefined) throw new Error("Invalid checkbox change.");
    text = request.checked ? target.on : target.off;
  } else {
    if (typeof request.text !== "string" || request.text.length > 2_000_000) throw new Error("Invalid block text.");
    const eol = current.source.includes("\r\n") ? "\r\n" : "\n";
    text = request.text.replace(/\r\n?|\n/g, eol);
    if (target.kind === "frontmatter") {
      const parsed = splitFrontmatter(text);
      if (!parsed.frontmatter?.valid) throw new Error("Page attributes must be a valid YAML mapping between --- lines.");
      if (parsed.body.trim()) throw new Error("Edit only the page attributes here; put page content in its own block.");
      text = parsed.frontmatter.raw;
      if (!target.source) text += eol + eol;
    }
  }
  return { start: target.start, end: target.end, text };
}
