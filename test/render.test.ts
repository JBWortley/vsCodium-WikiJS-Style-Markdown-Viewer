import { describe, expect, it } from "vitest";
import { uslug, uniqueHeadingId } from "../src/render/slug";
import { splitFrontmatter } from "../src/render/frontmatter";
import { classifyLinkTarget, parseWikiPath } from "../src/render/paths";
import { renderFrontmatter, renderApp } from "../src/render/shell";
import { renderPage, type RenderContext } from "../src/render/page";
import { WIKI_DEFAULTS } from "../src/render/markdown";
import { highlightFence } from "../src/render/highlight";
import { load } from "cheerio";

const ctx = (over: Partial<RenderContext> = {}): RenderContext => ({
  siteUrl: "https://wiki.example.test",
  pagePath: "about-drafting/sample",
  pageExists: (p) => p === "about-drafting" || p === "home",
  markdown: WIKI_DEFAULTS,
  ...over,
});
const html = (md: string, over?: Partial<RenderContext>) => renderPage(md, ctx(over)).contentHtml;

describe("uslug (Wiki.js heading ids)", () => {
  it("drops emoji but keeps the U+FE0F mark, as on the live site", () => {
    expect(uslug("🗺️ Where to Make a New Project Folder")).toBe("\uFE0F-where-to-make-a-new-project-folder");
    expect(uslug("📂 Set Up a Quick New Project Folder")).toBe("set-up-a-quick-new-project-folder");
  });
  it("drops punctuation and lowercases", () => {
    expect(uslug("Step 1: Save REF Documents")).toBe("step-1-save-ref-documents");
    expect(uslug("Check & Submit (Drawings)")).toBe("check-submit-drawings");
  });
  it("prefixes numeric ids and de-duplicates", () => {
    const taken = new Set<string>();
    expect(uniqueHeadingId("1:100 Scale", undefined, taken)).toBe("h-1100-scale");
    expect(uniqueHeadingId("Notes", undefined, taken)).toBe("notes");
    expect(uniqueHeadingId("Notes", undefined, taken)).toBe("notes-1");
    expect(uniqueHeadingId("Notes", undefined, taken)).toBe("notes-2");
    expect(uniqueHeadingId("Anything", "custom", taken)).toBe("custom");
  });
});

describe("frontmatter table", () => {
  const src =
    "---\ntitle: \"Drafting: QA\"\ndescription: \npublished: true\ndate: 2026-09-02T22:16:47.633Z\ntags: steel, structures\neditor: markdown\ndateCreated: 2025-07-08T06:56:38.227Z\n---\n\n# Body\n";
  it("keeps every field, in file order, with raw values and source lines", () => {
    const split = splitFrontmatter(src);
    expect(split.frontmatter?.valid).toBe(true);
    expect(split.frontmatter?.entries).toEqual([
      { key: "title", value: "Drafting: QA", line: 1 },
      { key: "description", value: "", line: 2 },
      { key: "published", value: "true", line: 3 },
      { key: "date", value: "2026-09-02T22:16:47.633Z", line: 4 },
      { key: "tags", value: "steel, structures", line: 5 },
      { key: "editor", value: "markdown", line: 6 },
      { key: "dateCreated", value: "2025-07-08T06:56:38.227Z", line: 7 },
    ]);
    expect(split.bodyLineOffset).toBe(9);
    expect(split.body.split("\n")[1]).toBe("# Body");
  });
  it("renders a compact, escaped table and no site chrome", () => {
    const page = renderPage(src.replace("Drafting: QA", "A <b>bold</b> & co"), ctx());
    const table = renderFrontmatter(page);
    expect(table).toContain('<div class="wk-fm-row" data-line="1"><dt>title</dt><dd>A &lt;b&gt;bold&lt;/b&gt; &amp; co</dd></div>');
    expect(table).toContain('<dt>description</dt><dd class="wk-fm-empty"></dd>');
    expect(renderApp(page)).not.toMatch(/wk-appbar|wk-breadcrumbs|wk-header-band|wk-col-sd|page-toc-card|Knowledge Base/);
  });
  it("shows invalid YAML as the raw block instead of hiding it", () => {
    const page = renderPage("---\ntitle: [unclosed\n---\nbody", ctx());
    expect(page.frontmatter?.valid).toBe(false);
    expect(renderFrontmatter(page)).toBe('<pre class="wk-frontmatter-raw" data-line="0">---\ntitle: [unclosed\n---</pre>');
  });
  it("handles pages without frontmatter and YAML lists", () => {
    expect(splitFrontmatter("no frontmatter").frontmatter).toBeUndefined();
    expect(splitFrontmatter("no frontmatter").bodyLineOffset).toBe(0);
    expect(splitFrontmatter("---\ntags: [x, y]\n---\n").frontmatter?.entries[0]).toEqual({ key: "tags", value: "x, y", line: 1 });
  });
});

describe("markdown pipeline", () => {
  it("lifts {.is-*} onto the blockquote, including after a hard break", () => {
    expect(html("> text\n{.is-info}")).toContain('<blockquote class="is-info"');
    expect(html("> Put drawings here.  \n{.is-warning}")).toMatch(/<blockquote class="is-warning"[^>]*>\s*<p[^>]*>Put drawings here\.<br>/);
  });
  it("applies breaks, typographer and linkify like wiki.example.test", () => {
    const out = html("easy:\nChanging client's \"plan\"...");
    expect(out).toContain("easy:<br>");
    expect(out).toContain("client’s “plan”…");
    expect(html("see https://example.com/x")).toContain('<a href="https://example.com/x" class="is-external-link">');
  });
  it("adds data-line offset by the frontmatter length", () => {
    const out = html("---\ntitle: T\n---\n\nPara one\n\n## Heading\n");
    expect(out).toContain('<p data-line="4">Para one</p>');
    expect(out).toMatch(/<h2 data-line="6"/);
  });
  it("anchors headings like the site", () => {
    const page = renderPage("# One\n\n## Two\n", ctx());
    expect(page.contentHtml).toContain('<a class="toc-anchor" href="#one">¶</a> One');
    expect(page.contentHtml).toContain('<a class="toc-anchor" href="#two">¶</a> Two');
  });
  it("wraps root tables and root text, but not nested tables", () => {
    expect(html("| a |\n|---|\n| 1 |")).toMatch(/^<div class="table-container"><table/);
    expect(html("<details>\n\n| a |\n|---|\n| 1 |\n\n</details>  \n\nnext")).not.toContain("table-container");
    expect(html("<details>x</details>  \n\npara")).toContain("<div>  \n</div>");
  });
});

describe("links", () => {
  it("classifies internal, invalid, own-host, asset, external and system links", () => {
    const out = html(
      "[a](/about-drafting) [b](/missing-page) [c](https://wiki.example.test/en/about-drafting) [d](/policy_assets/x.pdf) [e](https://example.com) [f](/t/tag) [g](#anchor)",
    );
    expect(out).toContain('<a href="/about-drafting" class="is-internal-link is-valid-page">a</a>');
    expect(out).toContain('<a href="/missing-page" class="is-internal-link is-invalid-page">b</a>');
    expect(out).toContain('<a href="/en/about-drafting" class="is-internal-link is-valid-page">c</a>');
    expect(out).toContain('<a href="/policy_assets/x.pdf" class="is-asset-link">d</a>');
    expect(out).toContain('class="is-external-link">e</a>');
    expect(out).toContain('<a href="/t/tag" class="is-system-link">f</a>');
    expect(out).toContain('<a href="#anchor">g</a>');
  });
  it("resolves relative page links as children of the current page (Wiki.js rule)", () => {
    expect(html("[x](child)")).toContain('href="/about-drafting/sample/child"');
    expect(html("[x](child)", { pagePath: "home" })).toContain('href="/child"');
  });
  it("routes clicks the same way", () => {
    const site = "https://wiki.example.test";
    expect(classifyLinkTarget("/en/about-scaffold/systems#top", site, "home")).toEqual({ kind: "page", pagePath: "about-scaffold/systems", hash: "top" });
    expect(classifyLinkTarget("https://wiki.example.test/about-drafting", site, "home")).toEqual({ kind: "page", pagePath: "about-drafting", hash: undefined });
    expect(classifyLinkTarget("/assets/x y.png", site, "home")).toEqual({ kind: "asset", relativePath: "assets/x y.png", fromRoot: true });
    expect(classifyLinkTarget("../other.md", site, "a/b/c")).toEqual({ kind: "page", pagePath: "a/other", hash: undefined });
    expect(classifyLinkTarget("https://example.com", site, "home")).toEqual({ kind: "external", url: "https://example.com" });
    expect(classifyLinkTarget("file:///C:/x.exe", site, "home").kind).toBe("ignored");
    expect(classifyLinkTarget("command:workbench.action.quit", site, "home").kind).toBe("ignored");
    expect(classifyLinkTarget("javascript:alert(1)", site, "home").kind).toBe("ignored");
  });
  it("parses paths exactly like Wiki.js parsePath", () => {
    expect(parseWikiPath("/en/About-Scaffold/")).toEqual({ locale: "en", path: "About-Scaffold" });
    expect(parseWikiPath("/")).toEqual({ locale: "en", path: "home" });
    expect(parseWikiPath("/t/x")).toEqual({ locale: "en", path: "x" }); // one-letter first segment dropped
    expect(parseWikiPath("/a%20b/../c")).toEqual({ locale: "en", path: "a b/c" }); // ".." text removed, not resolved
    expect(() => parseWikiPath("/..")).toThrow(); // nothing left: Wiki.js throws, html-core skips the link
  });
});

describe("sanitizer (Wiki.js DOMPurify behaviour + webview safety)", () => {
  it("removes active content and event handlers (iframes stay: the site allows them)", () => {
    const out = html('<script>alert(1)</script><img src="x.png" onerror="alert(1)"><iframe src="https://x" onload="alert(1)" srcdoc="<b>"></iframe><base href="https://evil/"><object data="x"></object>\n\ntext');
    expect(out).not.toMatch(/<script|onerror|onload|srcdoc|<base|<object/);
    expect(out).toContain('<img src="x.png">');
    expect(out).toContain('<iframe src="https://x"></iframe>');
  });
  it("strips unsafe URLs like the live site strips file:///", () => {
    const out = html('<a href="file:///C:/x">f</a> <a href="javascript:alert(1)">j</a> <a href=" java\tscript:alert(1)">k</a> <img src="data:image/png;base64,AAAA">');
    expect(out).toContain('<a class="is-external-link">f</a>');
    // Wiki.js turns scheme-like hrefs without "://" into relative page paths (inert), e.g.
    // "/about-drafting/sample/javascript:alert(1)"; no href may start with a script scheme.
    expect(out).not.toMatch(/href="\s*java\s*script:/i);
    expect(out).toContain('href="/about-drafting/sample/javascript:alert(1)"');
    expect(out).toContain('src="data:image/png;base64,AAAA"');
  });
  it("drops ids that would clobber document properties, keeping the TOC anchor", () => {
    const page = renderPage("#### Images\n", ctx());
    expect(page.contentHtml).toContain('<h4 data-line="0" class="toc-header"><a class="toc-anchor" href="#images">');
  });
  it("trims attribute values like DOMPurify", () => {
    expect(html('<img src="a.png " alt=" x ">')).toContain('<img src="a.png" alt="x">');
  });
  it("rewrites local image sources only through the resolver", () => {
    const out = html("![a](/assets/a.png) ![b](https://example.com/b.png)", { resolveAsset: (s) => (s.startsWith("/") ? `https://res${s}` : undefined) });
    expect(out).toContain('src="https://res/assets/a.png"');
    expect(out).toContain('data-wiki-src="/assets/a.png"');
    expect(out).toContain('src="https://example.com/b.png"');
  });
});

describe("code blocks", () => {
  it("matches the live Prism markup, including the bare-fence quirk", () => {
    const yaml = highlightFence("title: x\n", "yaml");
    expect(yaml).toMatch(/^<div class="code-toolbar"><pre class="prismjs line-numbers language-yaml"><code class="language-yaml">/);
    expect(yaml).toContain('<span aria-hidden="true" class="line-numbers-rows"><span></span></span></code></pre>');
    expect(highlightFence("a\nb\n", "")).toContain('<code class="language- language-none">a\nb<span aria-hidden="true" class="line-numbers-rows"><span></span><span></span></span>');
    expect(highlightFence("x", "extend")).toContain("language-extend");
  });
});

describe("audit regressions (2026-11-12, checked against Wiki.js 2.5.300 sources)", () => {
  it("slugs collapse ' - ' to one hyphen like uslug 1.0.4", () => {
    expect(uslug("Example Company Ltd, UK - Profile")).toBe("example-company-ltd-uk-profile");
    expect(uslug("A -- B")).toBe("a-b");
  });
  it("host links need a trailing slash; trailing slashes are kept; case matters for validity", () => {
    const out = html("[a](https://wiki.example.test) [b](https://wiki.example.test.evil.com/x) [c](/about-drafting/) [d](/About-Drafting) [e](/a)");
    expect(out).toContain('<a href="https://wiki.example.test" class="is-external-link">a</a>');
    expect(out).toContain('<a href="https://wiki.example.test.evil.com/x" class="is-external-link">b</a>');
    expect(out).toContain('<a href="/about-drafting/" class="is-internal-link is-valid-page">c</a>');
    expect(out).toContain('<a href="/About-Drafting" class="is-internal-link is-invalid-page">d</a>');
    expect(out).toContain('<a href="/a" class="is-system-link">e</a>');
  });
  it("keeps empty hrefs (DOMPurify does)", () => {
    expect(html('<a href="">x</a>')).toContain('<a href="">x</a>');
  });
  it("turns indented code and raw <pre><code> into Prism blocks (html-codehighlighter)", () => {
    const indented = html("para\n\n    indented code\n");
    expect(indented).toContain('<div class="code-toolbar" data-line="2"><pre class="prismjs line-numbers language-none"><code class="language- language-none">indented code');
    expect(html('<pre><code class="language-yaml">a: 1</code></pre>')).toContain('<code class="language-yaml"><span class="token key atrule">a</span>');
  });
  it("drops pseudo-tags and <style> like the live page", () => {
    // Inside a raw HTML block, so it reaches the HTML parser.
    const out = html("<p></p>\n<TODO: there is no good image of this online> \n\nafter\n\n<style>body{display:none}</style>");
    expect(out).not.toMatch(/todo|<style/i);
    expect(out).toContain("after");
  });
  it("leaves nothing executable after a parse/serialize/parse round trip (mXSS)", () => {
    const payloads = [
      'Text\n\n<math><mtext><table><mglyph><style><img src=x onerror=alert(1)><a href="javascript:alert(2)">click</a>',
      '<svg><a><animate attributeName="href" values="javascript:alert(1)"/><text y="20">x</text></a></svg>',
      '<svg><set attributeName="href" to="javascript:alert(1)"/></svg>',
    ];
    for (const p of payloads) {
      const $ = load(`<div id="r">${html(p)}</div>`);
      expect($("[onerror],[onload],[onclick]").length, p).toBe(0);
      expect($('[href^="javascript"],[values*="javascript"],[to*="javascript"]').length, p).toBe(0);
      expect($("animate,set,style,mglyph").length, p).toBe(0);
    }
  });
  it("keeps https iframes like the live site, minus attributes DOMPurify drops", () => {
    const out = html('<iframe src="https://www.google.com/maps?q=x&amp;output=embed" width="50%" height="400" style="border:0;" title="Map" allowfullscreen loading="lazy" referrerpolicy="no-referrer"></iframe>');
    expect(out).toContain('<iframe src="https://www.google.com/maps?q=x&amp;output=embed" width="50%" height="400" style="border:0;" title="Map" loading="lazy"></iframe>');
  });
  it("routes '..' in page links the way Wiki.js does, never above the root", () => {
    // Any "." makes it an asset link in Wiki.js; the panel then refuses paths outside the root.
    const t = classifyLinkTarget("/../../../../Users/example/secret", "https://wiki.example.test", "home");
    expect(t).toEqual({ kind: "asset", relativePath: "../../../../Users/example/secret", fromRoot: true });
    expect(classifyLinkTarget("../../../../x.md", "https://wiki.example.test", "a/b")).toEqual({ kind: "page", pagePath: "x", hash: undefined });
    // (Two-letter segments are locales in Wiki.js, so use a real page name.)
    expect(classifyLinkTarget("/%2e%2e/%2e%2e/home-page", "https://wiki.example.test", "home")).toEqual({ kind: "page", pagePath: "home-page", hash: undefined });
    expect(classifyLinkTarget("/%2e%2e/x", "https://wiki.example.test", "home").kind).toBe("ignored"); // nothing left
  });
  it("an empty frontmatter block does not swallow the page", () => {
    const split = splitFrontmatter("---\n---\n# Title\n\ntext\n---\nmore");
    expect(split.body.startsWith("# Title")).toBe(true);
    expect(split.bodyLineOffset).toBe(2);
  });
});
