import { beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { renderPage } from "../src/render/page";
import { WIKI_DEFAULTS } from "../src/render/markdown";

let previewBundle: string;
const TOKEN = "test-only-channel-token";
const ORIGIN = "https://preview.example.test";

beforeAll(async () => {
  const result = await build({ entryPoints: ["src/webview/preview.ts"], bundle: true, platform: "browser", format: "iife", write: false });
  previewBundle = result.outputFiles[0].text;
});

function fixture(testMode = true) {
  const dom = new JSDOM(`<div id="wk-root" data-message-token="${TOKEN}" data-test-mode="${testMode}"></div>`, {
    url: ORIGIN, runScripts: "outside-only", pretendToBeVisual: true,
  });
  const messages: { type: string; [key: string]: unknown }[] = [];
  const { window } = dom;
  Object.assign(window, {
    acquireVsCodeApi: () => ({ postMessage: (msg: typeof messages[number]) => messages.push(msg), getState: () => undefined, setState: () => {} }),
    scrollTo: () => {},
  });
  window.eval(previewBundle);
  const send = (data: unknown, origin = ORIGIN, source: Window | null = null) =>
    window.dispatchEvent(new window.MessageEvent("message", { data, origin, source }));
  const page = renderPage('# Trusted\n\n<a id="safe-link" href="https://example.com/">Example</a>', {
    siteUrl: "", pagePath: "home", pageExists: () => true, markdown: WIKI_DEFAULTS,
  });
  send({ type: "render", uri: "file:///demo/home.md", page, token: TOKEN });
  return { dom, window, messages, send };
}

describe("webview message boundary", () => {
  it("rejects messages from embedded frames, even if they include a valid channel token", () => {
    const f = fixture();
    try {
      const iframe = f.window.document.createElement("iframe");
      f.window.document.body.appendChild(iframe);
      f.send({ type: "renderError", message: "Forged error", token: TOKEN }, "https://embed.example.test", iframe.contentWindow);
      f.send({ type: "test:click", selector: "#safe-link", token: TOKEN }, "https://embed.example.test", iframe.contentWindow);
      expect(f.window.document.getElementById("wk-error")).toBeNull();
      expect(f.messages.filter(m => m.type === "link" || m.type === "copy")).toEqual([]);
    } finally { f.dom.window.close(); }
  });

  it("rejects unauthenticated messages from the same origin", () => {
    const f = fixture();
    try {
      f.send({ type: "renderError", message: "Missing token" });
      f.send({ type: "renderError", message: "Wrong token", token: "wrong" });
      expect(f.window.document.getElementById("wk-error")).toBeNull();
      expect(f.window.document.getElementById("trusted")).not.toBeNull();
    } finally { f.dom.window.close(); }
  });

  it("does not enable synthetic clicks in production views", () => {
    const f = fixture(false);
    try {
      f.send({ type: "test:click", selector: "#safe-link", token: TOKEN });
      expect(f.messages.filter(m => m.type === "link")).toEqual([]);
    } finally { f.dom.window.close(); }
  });

  it("accepts authenticated host renders and test commands in a test view", () => {
    const f = fixture();
    try {
      expect(f.window.document.getElementById("trusted")).not.toBeNull();
      f.send({ type: "test:click", selector: "#safe-link", token: TOKEN });
      expect(f.messages.filter(m => m.type === "link")).toEqual([{ type: "link", href: "https://example.com/" }]);
    } finally { f.dom.window.close(); }
  });
});

describe("asset refresh reconciliation", () => {
  it("handles Ctrl+Shift+R and Cmd+Shift+R inside the page without forwarding the shortcut to the workbench", () => {
    const f = fixture(false);
    try {
      const forwarded: KeyboardEvent[] = [];
      f.window.addEventListener("keydown", event => forwarded.push(event as unknown as KeyboardEvent));
      for (const modifier of ["ctrlKey", "metaKey"]) {
        const event = new f.window.KeyboardEvent("keydown", { key: "r", [modifier]: true, shiftKey: true, bubbles: true, cancelable: true });
        f.window.document.getElementById("trusted")!.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
      }
      expect(f.messages.filter(message => message.type === "refresh")).toEqual([{ type: "refresh" }, { type: "refresh" }]);
      expect(forwarded).toHaveLength(0);
    } finally { f.dom.window.close(); }
  });

  it("does not treat typing, other shortcuts or keys in editable controls as page refresh", () => {
    const f = fixture(false);
    try {
      const input = f.window.document.createElement("textarea");
      f.window.document.body.appendChild(input);
      input.dispatchEvent(new f.window.KeyboardEvent("keydown", { key: "r", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
      for (const init of [{ key: "r" }, { key: "r", ctrlKey: true }, { key: "r", ctrlKey: true, altKey: true, shiftKey: true }]) {
        f.window.document.body.dispatchEvent(new f.window.KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true }));
      }
      expect(f.messages.filter(message => message.type === "refresh")).toHaveLength(0);
    } finally { f.dom.window.close(); }
  });

  it("updates changed asset URLs while retaining open details and unchanged content nodes", () => {
    const f = fixture();
    try {
      const page = (key: string) => renderPage('<details><summary>More</summary><img src="/drawing.svg"></details>\n\nUnchanged paragraph', {
        siteUrl: "", pagePath: "home", pageExists: () => true, markdown: WIKI_DEFAULTS,
        resolveAsset: () => `https://res/wiki/drawing.svg?__wikijs_preview=${key}`,
      });
      const render = (key: string) => f.send({ type: "render", uri: "file:///demo/home.md", page: page(key), token: TOKEN });
      render("first");
      const paragraph = f.window.document.querySelector("#wk-contents > p");
      const image = f.window.document.querySelector("img");
      f.window.document.querySelector("details")!.open = true;
      render("first");
      expect(f.window.document.querySelector("img")).toBe(image);
      render("next");
      expect(f.window.document.querySelector("img")?.getAttribute("src")).toBe("https://res/wiki/drawing.svg?__wikijs_preview=next");
      expect(f.window.document.querySelector("details")?.open).toBe(true);
      expect(f.window.document.querySelector("#wk-contents > p")).toBe(paragraph);
    } finally { f.dom.window.close(); }
  });
});

describe("page block editing", () => {
  function editable(source: string) {
    const f = fixture(false);
    const page = renderPage(source, { siteUrl: "", pagePath: "home", pageExists: () => true, markdown: WIKI_DEFAULTS, editKey: "editable-4" });
    const render = () => f.send({ type: "render", uri: "file:///demo/home.md", page, token: TOKEN });
    render();
    const click = (selector: string, init = {}) => f.window.document.querySelector(selector)!.dispatchEvent(new f.window.MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
    return { ...f, page, render, click };
  }

  it("edits text on double-click; Cancel never changes source and Apply sends only the selected block", () => {
    const f = editable("Hello **world**.\n\nOther paragraph.");
    try {
      const p = f.window.document.querySelector("#wk-contents p")!;
      p.dispatchEvent(new f.window.MouseEvent("dblclick", { bubbles: true }));
      const textarea = f.window.document.querySelector<HTMLTextAreaElement>(".wk-block-editor textarea")!;
      expect(textarea.value).toBe("Hello **world**.");
      textarea.value = "New **text**.";
      f.click('.wk-block-editor [data-action="cancel"]');
      expect(f.messages.filter(m => m.type === "edit")).toHaveLength(0);
      p.dispatchEvent(new f.window.MouseEvent("dblclick", { bubbles: true }));
      f.window.document.querySelector<HTMLTextAreaElement>(".wk-block-editor textarea")!.value = "New **text**.";
      f.click('.wk-block-editor [data-action="apply"]');
      expect(f.messages.filter(m => m.type === "edit")).toEqual([{ type: "edit", id: p.getAttribute("data-wk-edit"), text: "New **text**." }]);
    } finally { f.dom.window.close(); }
  });

  it("Shift-click edits original HTML instead of following links; rejected edits and refresh preserve the draft", () => {
    const f = editable('<a id="object" href="https://example.com">Original</a>');
    try {
      f.click("#object", { shiftKey: true });
      const textarea = f.window.document.querySelector<HTMLTextAreaElement>(".wk-block-editor textarea")!;
      expect(textarea.value).toBe('<a id="object" href="https://example.com">Original</a>');
      textarea.value = '<img src="x" onerror="alert(1)">';
      f.render();
      expect(f.window.document.querySelector(".wk-block-editor textarea")).toBe(textarea);
      f.click('.wk-block-editor [data-action="apply"]');
      const id = f.page.editTargets!.find(t => t.kind === "html")!.id;
      f.send({ type: "editResult", id, ok: false, message: "The document changed.", token: TOKEN });
      expect(textarea.value).toContain("onerror");
      expect(f.window.document.querySelector(".wk-edit-error")?.textContent).toBe("The document changed.");
      expect(f.window.document.querySelector(".wk-block-editor img")).toBeNull();
      expect(f.messages.filter(m => m.type === "link")).toHaveLength(0);
    } finally { f.dom.window.close(); }
  });

  it("checkboxes submit a targeted toggle, attributes use Apply/Cancel, and frames have an accessible edit action", () => {
    const f = editable('---\ntitle: Old\n---\n\n- [ ] Task\n\n<iframe src="https://example.com"></iframe>');
    try {
      const check = f.window.document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
      expect(check.disabled).toBe(false);
      check.click();
      expect(f.messages.filter(m => m.type === "edit")).toContainEqual({ type: "edit", id: check.getAttribute("data-wk-check"), checked: true });
      f.send({ type: "editResult", id: check.getAttribute("data-wk-check"), ok: true, token: TOKEN });
      f.click('.wk-edit-attributes');
      expect(f.window.document.querySelector<HTMLTextAreaElement>(".wk-block-editor textarea")?.value).toBe('---\ntitle: Old\n---');
      f.click('.wk-block-editor [data-action="cancel"]');
      f.click('.wk-edit-frame');
      expect(f.window.document.querySelector<HTMLTextAreaElement>(".wk-block-editor textarea")?.value).toBe('<iframe src="https://example.com"></iframe>');
    } finally { f.dom.window.close(); }
  });
});
