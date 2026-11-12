import DOMPurify from "dompurify";
import { renderApp, renderFrontmatter } from "../render/shell";
import type { FromWebview, ToWebview } from "../render/protocol";
import { createSanitizer } from "./sanitize";
import { BlockEditor, type SavedDrafts } from "./editing";

interface VsCodeApi {
  postMessage(msg: FromWebview): void;
  getState(): PersistedState | undefined;
  setState(state: PersistedState): void;
}
interface PersistedState {
  uri?: string;
  scrollY?: number;
  drafts?: SavedDrafts;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
const root = document.getElementById("wk-root") as HTMLElement;
const messageToken = root.dataset.messageToken;
const testMode = root.dataset.testMode === "true";
let state: PersistedState = vscode.getState() ?? {};
let currentUri: string | undefined;
const sanitize = createSanitizer(DOMPurify, document);
let deferredRender: Extract<ToWebview, { type: "render" }> | undefined;
const editing = new BlockEditor(message => vscode.postMessage(message), state.drafts ?? {}, drafts => setState({ drafts }), () => {
  if (!deferredRender) return;
  const next = deferredRender;
  deferredRender = undefined;
  render(next);
  reportPaint(next.uri);
});

function setState(patch: PersistedState): void {
  state = { ...state, ...patch };
  vscode.setState(state);
}

/**
 * Replaces only the top-level nodes that changed, so images and scroll position survive edits.
 * Page HTML goes through DOMPurify as DOM nodes and is never re-serialized.
 */
function morphChildren(target: Element, html: string): void {
  const next = Array.from(sanitize(html).childNodes);
  const current = Array.from(target.childNodes);
  for (let i = 0; i < Math.max(next.length, current.length); i++) {
    const a = current[i];
    const b = next[i];
    if (!b) {
      a.remove();
      continue;
    }
    if (!a) {
      target.appendChild(b);
      continue;
    }
    carryDetailsState(a, b);
    if (!a.isEqualNode(b)) target.replaceChild(b, a);
  }
}

/** Keeps <details> the reader opened open across re-renders. */
function carryDetailsState(from: Node, to: Node): void {
  if (!(from instanceof Element) || !(to instanceof Element)) return;
  const list = (el: Element) => [...(el.matches("details") ? [el] : []), ...Array.from(el.querySelectorAll("details"))] as HTMLDetailsElement[];
  const a = list(from);
  const b = list(to);
  if (a.length === b.length) b.forEach((d, i) => (d.open = a[i].open));
}

function replaceIfChanged(id: string, html: string): void {
  const el = document.getElementById(id);
  if (el && el.innerHTML !== html) el.innerHTML = html;
}

function render(msg: Extract<ToWebview, { type: "render" }>): void {
  const { page, uri } = msg;
  if (editing.defer(uri)) { deferredRender = msg; return; }
  deferredRender = undefined;
  editing.detach();
  if (uri !== currentUri || !document.getElementById("wk-contents")) {
    const restoreScroll = uri === state.uri ? (state.scrollY ?? 0) : 0;
    // The frontmatter table is our own escaped markup; the page body goes through the sanitizer.
    root.innerHTML = renderApp(page);
    morphChildren(document.getElementById("wk-contents") as HTMLElement, page.contentHtml);
    currentUri = uri;
    setState({ uri, scrollY: restoreScroll });
    window.scrollTo(0, restoreScroll);
    editing.attach(page, uri);
    return;
  }
  replaceIfChanged("wk-frontmatter", renderFrontmatter(page));
  morphChildren(document.getElementById("wk-contents") as HTMLElement, page.contentHtml);
  editing.attach(page, uri);
}

function reportPaint(uri: string): void {
  requestAnimationFrame(() => {
    const callout = document.querySelector("#wk-contents blockquote.is-info");
    vscode.postMessage({
      type: "painted",
      uri,
      blocks: document.getElementById("wk-contents")?.children.length ?? 0,
      height: document.documentElement.scrollHeight,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      background: getComputedStyle(document.body).backgroundColor,
      calloutBackground: callout ? getComputedStyle(callout).backgroundColor : undefined,
    });
  });
}

function showError(message: string): void {
  let box = document.getElementById("wk-error");
  if (!box) {
    box = document.createElement("div");
    box.id = "wk-error";
    box.className = "wk-render-error";
    root.prepend(box);
  }
  box.textContent = message;
}

/**
 * Finds a heading by id. On the live site DOMPurify strips ids that clash with document
 * properties (e.g. "images"), leaving only the anchor's href, so fall back to that.
 */
function findAnchor(id: string): Element | null {
  return document.getElementById(id) ?? document.querySelector(`a.toc-anchor[href="#${CSS.escape(id)}"]`)?.parentElement ?? null;
}

function scrollToAnchor(id: string): void {
  findAnchor(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Editor-to-preview sync: interpolate between the blocks around the editor's top line. */
function scrollToLine(line: number): void {
  if (editing.defer(currentUri ?? "")) return;
  const blocks = Array.from(document.querySelectorAll<HTMLElement>("#wk-contents [data-line]"))
    .map((el) => ({ el, line: Number(el.dataset.line) }))
    .filter((b) => Number.isFinite(b.line) && b.el.getClientRects().length > 0)
    .sort((a, b) => a.line - b.line);
  if (!blocks.length) return;
  // The editor is still in the frontmatter (or above the first block): show the top of the page.
  if (line <= 0 || line < blocks[0].line) {
    window.scrollTo(0, 0);
    return;
  }
  let prev = blocks[0];
  let next: (typeof blocks)[number] | undefined;
  for (const b of blocks) {
    if (b.line <= line) prev = b;
    else {
      next = b;
      break;
    }
  }
  const top = (el: HTMLElement) => el.getBoundingClientRect().top + window.scrollY;
  let y = top(prev.el);
  if (next && next.line > prev.line) y += ((line - prev.line) / (next.line - prev.line)) * (top(next.el) - y);
  window.scrollTo(0, Math.max(0, y - 8));
}

/** Prism's copy-to-clipboard behaviour; the extension host writes the clipboard. */
function copyCode(button: HTMLButtonElement): void {
  const code = button.closest(".code-toolbar")?.querySelector("pre code");
  if (!code) return;
  const clone = code.cloneNode(true) as Element;
  clone.querySelector(".line-numbers-rows")?.remove();
  vscode.postMessage({ type: "copy", text: clone.textContent ?? "" });
  button.textContent = "Copied!";
  setTimeout(() => (button.textContent = "Copy"), 5000);
}

document.addEventListener("click", (event) => {
  if (editing.handleClick(event)) return;
  const target = event.target as Element | null;
  const copy = target?.closest<HTMLButtonElement>(".code-toolbar .toolbar button");
  if (copy) {
    event.preventDefault();
    event.stopPropagation();
    copyCode(copy);
    return;
  }
  // <area> (image maps) navigates like <a>.
  const link = target?.closest("a, area");
  if (!link) return;
  // VSCodium's webview host has its own click listener on the window that opens http(s)/mailto
  // links and ignores defaultPrevented: stop the event here so each link opens exactly once.
  event.preventDefault();
  event.stopPropagation();
  const href = link.getAttribute("href");
  if (!href) return; // e.g. file:/// links, which the wiki strips too
  if (href.startsWith("#")) scrollToAnchor(safeDecode(href.slice(1)));
  else vscode.postMessage({ type: "link", href });
});

// Handle refresh inside the page, without taking over source-editor or terminal shortcuts.
// Ctrl/Cmd+R is reserved by the extension-development host's bootstrap reload handler.
document.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() !== "r" || !(event.ctrlKey || event.metaKey) || event.altKey || !event.shiftKey) return;
  const target = event.target;
  if (target instanceof Element && target.closest("input, textarea, select, [contenteditable]:not([contenteditable=false])")) return;
  event.preventDefault();
  event.stopPropagation(); // the editor's forwarding listener lives on window
  vscode.postMessage({ type: "refresh" });
});

// Forms in page HTML are kept (the wiki keeps them), but submitting one would navigate the
// webview away and blank the preview: block every submission. Found by the live test.
document.addEventListener(
  "submit",
  (event) => {
    event.preventDefault();
    event.stopPropagation();
  },
  true,
);

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

const scrollLog: string[] = [];
window.addEventListener("scroll", () => {
  if (scrollLog.length < 12) {
    const a = document.activeElement;
    scrollLog.push(`${Math.round(performance.now())}ms y=${Math.round(window.scrollY)} active=${a?.tagName}.${(a as HTMLElement | null)?.className ?? ""}`);
  }
});
let scrollSave: number | undefined;
window.addEventListener("scroll", () => {
  window.clearTimeout(scrollSave);
  scrollSave = window.setTimeout(() => setState({ scrollY: window.scrollY }), 200);
});

window.addEventListener("message", (event: MessageEvent<ToWebview & { token?: string }>) => {
  const msg = event.data;
  // VS Code relays from its same-origin outer frame, but replaces window.parent with window.
  // Authenticate the channel instead of trusting window.parent or messages from HTTPS embeds.
  if (event.origin !== window.location.origin || !msg || typeof msg !== "object" || !messageToken || msg.token !== messageToken) return;
  if (typeof msg.type !== "string" || (msg.type.startsWith("test:") && !testMode)) return;
  switch (msg.type) {
    case "render":
      document.getElementById("wk-error")?.remove();
      render(msg);
      reportPaint(msg.uri);
      break;
    case "renderError":
      showError(msg.message);
      break;
    case "editResult":
      editing.result(msg);
      break;
    case "scrollToLine":
      requestAnimationFrame(() => scrollToLine(msg.line));
      break;
    case "scrollToAnchor":
      scrollToAnchor(msg.id);
      break;
    case "test:click": {
      // A dispatched MouseEvent works on SVG elements too (they have no .click()); always answer.
      const el = document.querySelector(msg.selector);
      try {
        el?.dispatchEvent(new MouseEvent(msg.double ? "dblclick" : "click", { bubbles: true, cancelable: true, view: window, shiftKey: msg.shiftKey }));
      } catch {
        /* reported as clicked: false below only if the element is missing */
      }
      vscode.postMessage({ ...baseState(), clicked: !!el });
      break;
    }
    case "test:input": {
      const el = document.querySelector(msg.selector);
      if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
        el.value = msg.text;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
      vscode.postMessage({ ...baseState(), clicked: !!el });
      break;
    }
    case "test:state":
      vscode.postMessage({ ...baseState(), log: [...scrollLog, `state=${JSON.stringify(state)}`] });
      break;
    case "test:probeMessages": {
      const before = document.getElementById("wk-error")?.textContent;
      const source = document.querySelector("iframe")?.contentWindow ?? null;
      for (const [origin, token] of [["https://untrusted.example.test", messageToken], [window.location.origin, "wrong"], [window.location.origin, undefined]]) {
        window.dispatchEvent(new MessageEvent("message", {
          origin, source, data: { type: "renderError", message: "Untrusted-message probe", token },
        }));
      }
      vscode.postMessage({ ...baseState(), untrustedMessagesIgnored: document.getElementById("wk-error")?.textContent === before });
      break;
    }
    case "test:locate": {
      const el = document.querySelector<HTMLElement>(msg.selector);
      el?.scrollIntoView({ block: "center" });
      const r = el?.getBoundingClientRect();
      const hitEl = r ? document.elementFromPoint(r.x + Math.min(r.width / 2, 40), r.y + r.height / 2) : null;
      vscode.postMessage({
        ...baseState(),
        clicked: !!el,
        rect: r ? { x: r.x, y: r.y, width: r.width, height: r.height } : undefined,
        calib: mouseCalib,
        hit: hitEl ? describe(hitEl) : undefined,
      });
      break;
    }
    case "test:cover": {
      const el = document.querySelector<HTMLElement>(msg.selector);
      if (el) el.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:block;background:rgba(144,202,249,.15)";
      vscode.postMessage({ ...baseState(), clicked: !!el });
      break;
    }
    case "test:query": {
      const all = document.querySelectorAll(msg.selector);
      const image = all[0] instanceof HTMLImageElement ? all[0] : undefined;
      vscode.postMessage({
        ...baseState(),
        count: all.length,
        attr: msg.attr ? (all[0]?.getAttribute(msg.attr) ?? null) : undefined,
        value: all[0] instanceof HTMLTextAreaElement || all[0] instanceof HTMLInputElement ? all[0].value : undefined,
        text: all[0]?.textContent ?? undefined,
        image: image ? { complete: image.complete, width: image.naturalWidth, height: image.naturalHeight } : undefined,
        pwned: typeof (window as unknown as { __pwned?: unknown }).__pwned,
      });
      break;
    }
  }
});

function baseState(): Extract<FromWebview, { type: "test:state" }> {
  return {
    type: "test:state",
    scrollY: window.scrollY,
    title:
      Array.from(document.querySelectorAll(".wk-fm-row"))
        .find((row) => row.querySelector("dt")?.textContent === "title")
        ?.querySelector("dd")?.textContent ?? "",
    focused: document.hasFocus(),
    lastPointer,
  };
}

function describe(el: Element): string {
  return `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? `.${el.className.split(" ").join(".")}` : ""} "${(el.textContent ?? "").trim().slice(0, 40)}"`;
}

/** Live-test diagnostics: the last real pointer events the page received (capture phase). */
let lastPointer: string[] = [];
for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click", "focus", "blur"]) {
  window.addEventListener(
    type,
    (e) => {
      const m = e as MouseEvent;
      lastPointer = [...lastPointer.slice(-14), `${type} trusted=${m.isTrusted} at ${Math.round(m.clientX)},${Math.round(m.clientY)} on ${describe(m.target as Element)}`];
    },
    true,
  );
}

/** Live test: screen position of the webview, learned from real mouse moves (CSS px). */
let mouseCalib: { dx: number; dy: number; dpr: number; clientX: number; clientY: number; trusted: boolean } | undefined;
window.addEventListener("mousemove", (e) => {
  mouseCalib = { dx: e.screenX - e.clientX, dy: e.screenY - e.clientY, dpr: window.devicePixelRatio, clientX: e.clientX, clientY: e.clientY, trusted: e.isTrusted };
});

vscode.postMessage({ type: "ready" });
