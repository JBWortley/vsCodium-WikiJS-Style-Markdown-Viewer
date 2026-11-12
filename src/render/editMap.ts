import type MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token";
import { load } from "cheerio";
import type { Element } from "domhandler";
import type { EditTarget } from "../editing/edits";
import { splitFrontmatter } from "./frontmatter";

export const EDIT_ATTR = "data-wk-edit";
export const CHECK_ATTR = "data-wk-check";

/** Render-time metadata only. Source text is always kept byte-for-byte in the target spans. */
export function renderEditable(md: MarkdownIt, source: string, key: string): { html: string; targets: EditTarget[] } {
  if (!/^[a-zA-Z0-9-]+$/.test(key)) throw new Error("Invalid edit generation");
  const split = splitFrontmatter(source);
  const bom = source.startsWith("\uFEFF") ? 1 : 0;
  const bodyStart = source.length - split.body.length;
  const { text: body, offsets } = normalize(split.body, bodyStart);
  const lines = [0];
  for (let i = 0; i < body.length; i++) if (body[i] === "\n") lines.push(i + 1);
  const targets: EditTarget[] = [];
  const add = (kind: EditTarget["kind"], label: string, start: number, end: number, extra: Partial<EditTarget> = {}) => {
    const target: EditTarget = { id: `${key}-${targets.length}`, kind, label, start, end, source: source.slice(start, end), ...extra };
    targets.push(target);
    return target.id;
  };
  add("frontmatter", "Page attributes (YAML)", bom, split.frontmatter ? bom + split.frontmatter.raw.length : bom);
  const env = { lineOffset: split.bodyLineOffset, captureEdits: true };
  const tokens = md.parse(body, env);
  const span = (token: Token): [number, number] | undefined => {
    if (!token.map) return undefined;
    const start = lines[token.map[0]] ?? body.length;
    let end = lines[token.map[1]] ?? body.length;
    while (end > start && body[end - 1] === "\n") end--;
    return [start, end];
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const range = span(token);
    if (!range) continue;
    const [start, end] = range;
    if (token.type === "html_block") {
      const mapping = contentOffsets(token.content, token.map![0]);
      const parent = [...targets].reverse().find(t => t.kind === "markdown" && t.start <= offsets[start] && t.end >= offsets[end]);
      if (mapping) token.content = annotateHtml(token.content, mapping, parent?.id);
    } else if (token.block && token.nesting >= 0 && token.type !== "inline" && !token.hidden && (token.level === 0 || token.type === "list_item_open")) {
      const label = token.type === "blockquote_open" ? "Quote / callout (Markdown)" : "Text block (Markdown)";
      token.attrSet(EDIT_ATTR, add("markdown", label, offsets[start], offsets[end]));
    }
    if (token.type !== "inline" || !token.children) continue;
    // Only the task-list plugin's first child, backed by a real list-item marker, is a task.
    const checkbox = token.children[0];
    const marker = /^[\t >]*(?:[-+*]|\d+[.)])\s+\[([ xX])\](?=\s)/.exec(body.slice(start, lines[token.map![0] + 1] ?? body.length));
    if (tokens[i - 2]?.type === "list_item_open" && marker && checkbox?.type === "html_inline" && checkbox.content.startsWith('<input class="task-list-item-checkbox"')) {
      const pos = start + marker[0].lastIndexOf("[") + 1;
      const id = add("checkbox", "Task", offsets[pos], offsets[pos + 1], { on: "x", off: " ", checked: marker[1].toLowerCase() === "x" });
      checkbox.content = checkbox.content.replace("<input", `<input ${CHECK_ATTR}="${id}"`);
    }
    const inlineSource: string = token.meta?.editSource ?? token.content;
    const mapping = contentOffsets(inlineSource, token.map![0]);
    if (!mapping) continue;
    // Only actual html_inline tokens participate in tag matching. HTML-looking code/escaped
    // text must not close an element or steal the mapping of a repeated checkbox tag.
    const masked = inlineSource.replace(/[^\n]/g, " ").split("");
    for (const child of token.children) {
      if (child.type !== "html_inline" || !child.meta) continue;
      for (let j = child.meta.htmlStart; j < child.meta.htmlEnd; j++) masked[j] = inlineSource[j];
    }
    const parent = [...targets].reverse().find(t => t.kind === "markdown" && t.start <= offsets[start] && t.end >= offsets[end]);
    const htmlTargets = htmlLocations(masked.join(""), mapping, parent?.id);
    for (const child of token.children) {
      if (child.type !== "html_inline" || !child.meta) continue;
      const found = htmlTargets.find(t => t.openStart === child.meta.htmlStart && t.openEnd === child.meta.htmlEnd);
      if (found) child.content = insertMetadata(child.content, found, child.meta.htmlStart);
    }
  }

  return { html: md.renderer.render(tokens, md.options, env), targets };

  function htmlLocations(html: string, mapping: number[], parent?: string): HtmlLocation[] {
    const $ = load(html, { sourceCodeLocationInfo: true }, false);
    const found: HtmlLocation[] = [];
    $("*").each((_, node) => {
      const element = node as Element;
      const loc = element.sourceCodeLocation;
      if (!loc || !("startTag" in loc) || !loc.startTag) return;
      const openStart = loc.startTag.startOffset;
      const openEnd = loc.startTag.endOffset;
      const end = loc.endOffset;
      // A span crossing stripped list/quote prefixes must be edited as its Markdown container.
      let hasPrefixes = false;
      for (let i = loc.startOffset; i < end; i++) {
        const width = source.slice(mapping[i], mapping[i] + 2) === "\r\n" ? 2 : 1;
        if (mapping[i + 1] - mapping[i] !== width) { hasPrefixes = true; break; }
      }
      const id = hasPrefixes && parent ? parent : add("html", `HTML <${element.tagName}>`, mapping[loc.startOffset], mapping[end]);
      let checkId: string | undefined;
      if (element.tagName === "input" && element.attribs.type?.toLowerCase() === "checkbox") {
        const attr = (loc as typeof loc & { attrs?: Record<string, { startOffset: number; endOffset: number }> }).attrs?.checked;
        const pos = attr ? attr.startOffset : openEnd - (html[openEnd - 2] === "/" ? 2 : 1);
        const until = attr ? attr.endOffset : pos;
        checkId = add("checkbox", "Checkbox", mapping[pos], mapping[until], { on: attr ? source.slice(mapping[pos], mapping[until]) : " checked", off: "", checked: !!attr });
      }
      found.push({ id, checkId, openStart, openEnd });
    });
    return found;
  }

  function insertMetadata(html: string, loc: HtmlLocation, base: number): string {
    // First attribute wins in HTML parsing. Insert before source-supplied attributes; any
    // unrecognised reserved IDs are removed by the host's HTML processing pass.
    const openStart = loc.openStart - base;
    const at = openStart + /^<[^\s/>]+/.exec(html.slice(openStart))![0].length;
    return html.slice(0, at) + ` ${EDIT_ATTR}="${loc.id}"${loc.checkId ? ` ${CHECK_ATTR}="${loc.checkId}"` : ""}` + html.slice(at);
  }

  function annotateHtml(html: string, mapping: number[], parent?: string): string {
    const locations = htmlLocations(html, mapping, parent);
    // Insert backwards so source positions remain valid.
    for (const loc of locations.sort((a, b) => b.openEnd - a.openEnd)) html = insertMetadata(html, loc, 0);
    return html;
  }

  function contentOffsets(content: string, firstLine: number): number[] | undefined {
    const mapping: number[] = [];
    const parts = content.split("\n");
    for (let n = 0; n < parts.length; n++) {
      if (n === parts.length - 1 && !parts[n]) break;
      const lineStart = lines[firstLine + n] ?? body.length;
      const lineEnd = (lines[firstLine + n + 1] ?? body.length) - (body[(lines[firstLine + n + 1] ?? body.length) - 1] === "\n" ? 1 : 0);
      const line = body.slice(lineStart, lineEnd);
      let column = line.lastIndexOf(parts[n]);
      let padding = 0;
      if (column < 0) {
        // Markdown expands indentation tabs before stripping the list/quote prefix. Match
        // the unchanged suffix; generated indentation gets a conservative source position.
        const suffix = parts[n].trimStart();
        padding = parts[n].length - suffix.length;
        column = line.lastIndexOf(suffix);
        if (!padding || column < 0) return undefined;
      }
      for (let j = 0; j < padding; j++) mapping.push(offsets[lineStart]);
      for (let j = padding; j < parts[n].length; j++) mapping.push(offsets[lineStart + column + j - padding]);
      if (n < parts.length - 1) mapping.push(offsets[lineEnd]);
      if (n === parts.length - 1 || n === parts.length - 2 && !parts[n + 1]) mapping.push(offsets[n < parts.length - 1 ? lineEnd + 1 : lineStart + column + parts[n].length - padding]);
    }
    return mapping.length === content.length + 1 ? mapping : undefined;
  }
}

interface HtmlLocation { id: string; checkId?: string; openStart: number; openEnd: number }

function normalize(source: string, base: number): { text: string; offsets: number[] } {
  let text = "";
  const offsets: number[] = [];
  for (let i = 0; i < source.length; i++) {
    offsets.push(base + i);
    const char = source[i];
    text += char === "\r" ? "\n" : char === "\0" ? "\uFFFD" : char;
    if (char === "\r" && source[i + 1] === "\n") i++;
  }
  offsets.push(base + source.length);
  return { text, offsets };
}
