// markdown-it plugins pinned to the versions Wiki.js 2.5 ships; none of them publish types.
declare module "markdown-it-attrs" {
  import type MarkdownIt from "markdown-it";
  const plugin: MarkdownIt.PluginWithOptions<{ allowedAttributes?: string[] }>;
  export default plugin;
}
declare module "markdown-it-footnote" {
  import type MarkdownIt from "markdown-it";
  const plugin: MarkdownIt.PluginSimple;
  export default plugin;
}
declare module "markdown-it-sub" {
  import type MarkdownIt from "markdown-it";
  const plugin: MarkdownIt.PluginSimple;
  export default plugin;
}
declare module "markdown-it-sup" {
  import type MarkdownIt from "markdown-it";
  const plugin: MarkdownIt.PluginSimple;
  export default plugin;
}
declare module "markdown-it-abbr" {
  import type MarkdownIt from "markdown-it";
  const plugin: MarkdownIt.PluginSimple;
  export default plugin;
}
declare module "markdown-it-emoji" {
  import type MarkdownIt from "markdown-it";
  const plugin: MarkdownIt.PluginSimple;
  export default plugin;
}
declare module "markdown-it-task-lists" {
  import type MarkdownIt from "markdown-it";
  const plugin: MarkdownIt.PluginWithOptions<{ enabled?: boolean; label?: boolean; labelAfter?: boolean }>;
  export default plugin;
}
declare module "prismjs/components/*";
declare module "markdown-it/lib/rules_inline/html_inline" {
  import type StateInline from "markdown-it/lib/rules_inline/state_inline";
  const rule: (state: StateInline, silent: boolean) => boolean;
  export default rule;
}
