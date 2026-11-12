import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token";
import mdAttrs from "markdown-it-attrs";
import mdFootnote from "markdown-it-footnote";
import mdEmoji from "markdown-it-emoji";
import mdTaskLists from "markdown-it-task-lists";
import mdSub from "markdown-it-sub";
import mdSup from "markdown-it-sup";
import mdAbbr from "markdown-it-abbr";
import { highlightFence } from "./highlight";

export interface MarkdownOptions {
  breaks: boolean;
  typographer: boolean;
  linkify: boolean;
}

/** Wiki.js-compatible defaults (see docs/PLAN.md). */
export const WIKI_DEFAULTS: MarkdownOptions = { breaks: true, typographer: true, linkify: true };

export const DATA_LINE = "data-line";

/**
 * markdown-it configured like Wiki.js 2.5's markdown-core renderer: markdown-it 11 with
 * markdown-it-attrs 3 (whose "end of block" rule moves `{.is-info}` onto the blockquote),
 * footnotes, emoji, task lists, sub/sup and abbreviations.
 */
export function createMarkdown(options: MarkdownOptions): MarkdownIt {
  const md = new MarkdownIt({
    html: true,
    breaks: options.breaks,
    linkify: options.linkify,
    typographer: options.typographer,
  });
  md.use(mdAttrs, { allowedAttributes: ["id", "class", "target"] });
  md.use(mdFootnote);
  md.use(mdEmoji);
  md.use(mdTaskLists, { label: false, labelAfter: false });
  md.use(mdSub);
  md.use(mdSup);
  md.use(mdAbbr);

  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const lang = token.info.trim().split(/\s+/)[0] ?? "";
    return highlightFence(token.content, lang, token.attrGet(DATA_LINE)) + "\n";
  };
  md.core.ruler.push("wikijs_data_line", (state) => {
    const offset: number = state.env?.lineOffset ?? 0;
    for (const token of state.tokens) addDataLine(token, offset);
    return true;
  });
  return md;
}

/** Source line on every block element so the preview can follow the editor. */
function addDataLine(token: Token, offset: number): void {
  if (!token.block || !token.map || token.nesting < 0 || token.type === "html_block") return;
  token.attrSet(DATA_LINE, String(token.map[0] + offset));
}
