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
