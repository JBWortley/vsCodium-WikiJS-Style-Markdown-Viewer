import { splitFrontmatter, type Frontmatter } from "./frontmatter";
import { createMarkdown, type MarkdownOptions } from "./markdown";
import { processHtml, type HtmlCoreContext } from "./htmlCore";
import type MarkdownIt from "markdown-it";

export interface RenderContext extends HtmlCoreContext {
  markdown: MarkdownOptions;
}

export interface RenderedPage {
  pagePath: string;
  /** The frontmatter block, shown as a compact table above the body. */
  frontmatter?: Frontmatter;
  /** The page body, rendered the way the wiki renders it. */
  contentHtml: string;
  renderMs: number;
  /** Worker metadata for host file watching; not part of the rendered wiki HTML. */
  localAssets?: string[];
}

const mdCache = new Map<string, MarkdownIt>();

function markdownFor(options: MarkdownOptions): MarkdownIt {
  const key = JSON.stringify(options);
  let md = mdCache.get(key);
  if (!md) {
    md = createMarkdown(options);
    mdCache.set(key, md);
  }
  return md;
}

/** Pure: Wiki.js markdown source in, the frontmatter fields and the rendered body out. */
export function renderPage(source: string, ctx: RenderContext): RenderedPage {
  const started = performance.now();
  const { frontmatter, body, bodyLineOffset } = splitFrontmatter(source);
  const rawHtml = markdownFor(ctx.markdown).render(body, { lineOffset: bodyLineOffset });
  const { html } = processHtml(rawHtml, ctx);
  return {
    pagePath: ctx.pagePath,
    frontmatter,
    contentHtml: html,
    renderMs: Math.round(performance.now() - started),
  };
}
