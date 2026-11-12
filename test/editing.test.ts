import { describe, expect, it } from "vitest";
import { load } from "cheerio";
import { renderPage } from "../src/render/page";
import { WIKI_DEFAULTS } from "../src/render/markdown";
import { prepareEdit, type EditSnapshot } from "../src/editing/edits";

const render = (source: string) => renderPage(source, {
  siteUrl: "", pagePath: "home", pageExists: () => true, markdown: WIKI_DEFAULTS, editKey: "test-generation",
});
const snapshot = (source: string): EditSnapshot => ({ uri: "file:///home.md", version: 4, source, targets: render(source).editTargets! });

describe("source-backed editing", () => {
  it("maps text, whole callouts and fenced code without including neighbouring blocks", () => {
    const source = "# Title\n\nText **bold**.\n\n> Quote\n{.is-info}\n\n```html\n<b>Code</b>\n```\n\nAfter.\n";
    const page = render(source);
    const $ = load(page.contentHtml);
    for (const [selector, expected] of [["h1", "# Title"], ["p", "Text **bold**."], ["blockquote", "> Quote\n{.is-info}"], [".code-toolbar", "```html\n<b>Code</b>\n```"]]) {
      const id = $(selector).first().attr("data-wk-edit");
      const target = page.editTargets!.find(t => t.id === id)!;
      expect(target?.source).toBe(expected);
      expect(source.slice(target.start, target.end)).toBe(expected);
    }
  });

  it("maps nested HTML/SVG objects to the original tags, including CRLF and BOM", () => {
    const source = '\uFEFF---\r\ntitle: Example\r\n---\r\n\r\n<div class="card">\r\n<svg><rect width="20" /></svg>\r\n<p>Hello</p>\r\n</div>\r\n';
    const page = render(source);
    const $ = load(page.contentHtml);
    for (const selector of ["div.card", "svg", "rect", "p"]) {
      const target = page.editTargets!.find(t => t.id === $(selector).attr("data-wk-edit"))!;
      expect(target.kind).toBe("html");
      expect(source.slice(target.start, target.end)).toBe(target.source);
      expect(target.source.startsWith(`<${selector.split(".")[0]}`)).toBe(true);
    }
    const fm = page.editTargets!.find(t => t.kind === "frontmatter")!;
    expect(fm.start).toBe(1);
    expect(fm.source).toBe('---\r\ntitle: Example\r\n---');
  });

  it("maps inline HTML, Markdown tasks and HTML checkbox attributes precisely", () => {
    const source = 'Text <strong class="x">inline</strong> after.\n\n- [ ] One\n- [X] Two\n\n<input id="box" type="checkbox" checked="yes" data-note="keep">\n';
    const page = render(source);
    const $ = load(page.contentHtml);
    expect(page.editTargets!.find(t => t.id === $("strong.x").attr("data-wk-edit"))?.source).toBe('<strong class="x">inline</strong>');
    const checks = page.editTargets!.filter(t => t.kind === "checkbox");
    expect(checks).toHaveLength(3);
    expect(checks.slice(0, 2).map(t => t.source)).toEqual([" ", "X"]);
    for (const check of checks) expect($(`[data-wk-check="${check.id}"]`)).toHaveLength(1);
    const s = snapshot(source);
    const edit = prepareEdit(s, { uri: s.uri, version: 4, source }, { id: s.targets.find(t => t.kind === "checkbox" && t.source.includes("checked"))!.id, checked: false });
    const changed = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
    expect(changed).toContain('<input id="box" type="checkbox"  data-note="keep">');
  });

  it("preserves surrounding source and line endings, rejects stale/forged edits and invalid YAML", () => {
    const source = '\uFEFF---\r\ntitle: Old # retain\r\n---\r\n\r\nParagraph.\r\n\r\nLast.\r\n';
    const s = snapshot(source);
    const p = s.targets.find(t => t.source === "Paragraph.")!;
    const current = { uri: s.uri, version: 4, source };
    expect(prepareEdit(s, current, { id: p.id, text: "First\nsecond" })).toEqual({ start: p.start, end: p.end, text: "First\r\nsecond" });
    expect(() => prepareEdit(s, { ...current, version: 5 }, { id: p.id, text: "lost" })).toThrow(/changed/i);
    expect(() => prepareEdit(s, { ...current, uri: "file:///other.md" }, { id: p.id, text: "lost" })).toThrow();
    expect(() => prepareEdit(s, current, { id: "forged", text: "lost" })).toThrow();
    const fm = s.targets.find(t => t.kind === "frontmatter")!;
    expect(() => prepareEdit(s, current, { id: fm.id, text: "---\ntitle: [\n---" })).toThrow(/YAML/i);
    expect(() => prepareEdit(s, current, { id: fm.id, text: "---\ntitle: Fine\n---\nInjected body" })).toThrow(/attributes|frontmatter/i);
  });

  it("cannot turn source-supplied metadata into an authorised edit and leaves ordinary rendering unchanged", () => {
    const source = '<p data-wk-edit="forged" data-wk-check="forged">Example</p>\n';
    const page = render(source);
    expect(page.editTargets!.some(t => t.id === "forged")).toBe(false);
    expect(page.contentHtml).not.toContain('data-wk-check="forged"');
    expect(page.contentHtml).not.toContain('data-wk-edit="forged"');
    const plain = renderPage("Text", { siteUrl: "", pagePath: "home", pageExists: () => true, markdown: WIKI_DEFAULTS });
    expect(plain.editTargets).toBeUndefined();
    expect(plain.contentHtml).toBe('<p data-line="0">Text</p>\n');
  });

  it("maps identical inline HTML checkboxes separately and ignores HTML-looking inline code", () => {
    const source = 'Code `<input type="checkbox">` then <input type="checkbox"> A and <input type="checkbox"> B.';
    const page = render(source);
    const $ = load(page.contentHtml);
    const checks = page.editTargets!.filter(t => t.kind === "checkbox");
    expect(checks).toHaveLength(2);
    expect($("input[data-wk-check]")).toHaveLength(2);
    expect(checks[0].start).toBe(source.indexOf('> A'));
    expect(checks[1].start).toBe(source.indexOf('> B'));
    expect($("code").attr("data-wk-edit")).toBeUndefined();
  });

  it("retains source prefixes around nested quote/list HTML while making frames and checkboxes editable", () => {
    for (const prefix of ["> ", "  "]) {
      const source = (prefix === "  " ? "- Item\n\n" : "") + [`${prefix}<div>`, `${prefix}<iframe src="https://example.com"></iframe>`, `${prefix}<input type="checkbox">`, `${prefix}</div>`, ""].join("\n");
      const page = render(source);
      const $ = load(page.contentHtml);
      const frame = page.editTargets!.find(t => t.id === $("iframe").attr("data-wk-edit"))!;
      expect(frame?.source).toBe('<iframe src="https://example.com"></iframe>');
      const check = page.editTargets!.find(t => t.id === $("input").attr("data-wk-check"))!;
      expect(check?.kind).toBe("checkbox");
      expect(source[check.start]).toBe(">");
      const container = page.editTargets!.find(t => t.id === $("div[data-wk-edit]").attr("data-wk-edit"))!;
      expect(container.kind).toBe("markdown");
      expect(source.slice(container.start, container.end)).toBe(container.source);
    }
  });

  it("maps HTML after partially expanded indentation tabs", () => {
    const source = '- <div>\n\t<input type="checkbox">\n\t<iframe src="https://example.com"></iframe>\n\t</div>';
    const page = render(source);
    const $ = load(page.contentHtml);
    const check = page.editTargets!.find(t => t.id === $("input").attr("data-wk-check"))!;
    expect(check?.kind).toBe("checkbox");
    expect(source[check.start]).toBe(">");
    const frame = page.editTargets!.find(t => t.id === $("iframe").attr("data-wk-edit"))!;
    expect(frame?.source).toBe('<iframe src="https://example.com"></iframe>');
  });
});
