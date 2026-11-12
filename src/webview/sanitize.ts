import type { DOMPurify } from "dompurify";

/**
 * Second, independent sanitizing layer, run in the webview on the browser's own HTML parser
 * (which is what defeats parse/serialize "mutation XSS"). The config mirrors Wiki.js's
 * html-security module with "Allow iframes" on and draw.io support:
 * ADD_TAGS iframe/template/tabset/foreignObject, ADD_ATTR allow/target/v-pre.
 *
 * DOM-clobbering ids are already removed host-side with jsdom's name list (what the wiki's
 * server uses), so SANITIZE_DOM stays off here to avoid Chromium's longer list.
 *
 * Embeds: https iframes stay live but sandboxed (no top navigation, downloads or modals);
 * anything else becomes a placeholder card with the address.
 */
export const IFRAME_SANDBOX = "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation";

export function createSanitizer(purify: DOMPurify, doc: Document): (html: string) => DocumentFragment {
  purify.addHook("afterSanitizeAttributes", (node) => {
    if (node.nodeName.toLowerCase() !== "iframe") return;
    const el = node as Element;
    const src = el.getAttribute("src") ?? "";
    if (!/^https:\/\//i.test(src.trim())) {
      const card = doc.createElement("div");
      card.className = "wk-embed-blocked";
      const edit = el.getAttribute("data-wk-edit");
      if (edit) card.setAttribute("data-wk-edit", edit);
      card.textContent = src ? `Embedded content not shown (not https): ${src}` : "Embedded content not shown (no address)";
      el.replaceWith(card);
      return;
    }
    el.setAttribute("sandbox", IFRAME_SANDBOX);
    el.removeAttribute("srcdoc");
  });
  return (html: string) =>
    purify.sanitize(html, {
      ADD_TAGS: ["iframe", "template", "tabset", "foreignObject"],
      ADD_ATTR: ["allow", "target", "v-pre"],
      HTML_INTEGRATION_POINTS: { foreignobject: true },
      SANITIZE_DOM: false,
      RETURN_DOM_FRAGMENT: true,
    }) as unknown as DocumentFragment;
}
