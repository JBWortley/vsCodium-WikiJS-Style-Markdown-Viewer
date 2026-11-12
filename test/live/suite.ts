/**
 * Live test, run inside a real VSCodium window (scripts/livetest.mjs). Exercises the user flows
 * with real keystrokes (sent by the Windows driver), real clicks inside the webview, and the
 * webview's own report of what it painted. Never saves: typed text is reverted and every touched
 * vault file is hash-checked at the end.
 */
import * as vscode from "vscode";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { LiveTestApi } from "../../src/extension";
import type { PaintReport, ViewKind } from "../../src/preview/panel";

const OUT = process.env.WIKIJS_LIVETEST_DIR ?? "";
const VAULT = process.env.WIKIJS_LIVETEST_VAULT ?? "";
/** How `.md` opens on the machine being mirrored: "preview" (VSCodium setting) or "default" (text editor). */
const ASSOC = process.env.WIKIJS_LIVETEST_ASSOC === "default" ? "default" : "preview";
/** Built-in markdown custom editors this VS Code/VSCodium build ships (VS Code 1.123 lacks the WYSIWYG one). */
const BUILT_IN_EDITORS: string[] = (
  (vscode.extensions.getExtension("vscode.markdown-language-features")?.packageJSON?.contributes?.customEditors ?? []) as { viewType: string }[]
).map((c) => c.viewType);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const file = (rel: string) => vscode.Uri.file(path.join(VAULT, rel));
const PAGES = {
  home: file("home.md"),
  drafting: file("guide.md"),
  versioning: file("guide/revisions.md"),
  guidelines: file("guide/writing.md"),
};
const hash = (uri: vscode.Uri) => crypto.createHash("sha256").update(fs.readFileSync(uri.fsPath)).digest("hex");

interface Result {
  name: string;
  ok: boolean;
  /** The step does not apply to this VS Code/VSCodium build (reported as SKIP, not PASS). */
  skipped?: boolean;
  detail?: unknown;
  error?: string;
  ms: number;
}
const results: Result[] = [];
const save = () => fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));

let seq = 0;
/** Asks the Windows driver (outside VSCodium) for a screenshot or keystrokes. */
type DriverRequest =
  | { action: "screenshot"; name: string }
  | { action: "keys"; keys: string }
  | { action: "alttap" }
  | { action: "move"; fx: number; fy: number }
  | { action: "click"; x: number; y: number }
  | { action: "click"; fx: number; fy: number };

async function driver(req: DriverRequest): Promise<{ ok: boolean; info?: string }> {
  const n = ++seq;
  fs.writeFileSync(path.join(OUT, `req-${n}.json`), JSON.stringify(req));
  const ack = path.join(OUT, `ack-${n}.json`);
  for (let i = 0; i < 200; i++) {
    if (fs.existsSync(ack)) {
      const a = JSON.parse(fs.readFileSync(ack, "utf8")) as { ok: boolean; error?: string; info?: string };
      if (!a.ok) throw new Error(`driver ${req.action} failed: ${a.error}`);
      return a;
    }
    await sleep(150);
  }
  throw new Error(`driver ${req.action} timed out`);
}
const shot = (name: string) => driver({ action: "screenshot", name });
const keys = (k: string) => driver({ action: "keys", keys: k });

/** Shortcuts re-sent during the current step (reported, so a retry is never hidden). */
let stepRetries: string[] = [];
/**
 * Sends a shortcut and waits for its effect; if nothing happened within 4 s (e.g. the key was lost
 * to a focus race), sends it once more. Only for shortcuts whose effect is checked by `done`.
 */
async function shortcut(k: string, done: () => boolean): Promise<void> {
  await keys(k);
  const end = Date.now() + 4000;
  while (Date.now() < end) {
    if (done()) return;
    await sleep(150);
  }
  stepRetries.push(k);
  await keys(k);
}

async function waitFor<T>(label: string, probe: () => T | undefined | false | Promise<T | undefined | false>, timeout = 15000): Promise<T> {
  const end = Date.now() + timeout;
  let last: unknown;
  while (Date.now() < end) {
    try {
      const v = await probe();
      if (v) return v;
    } catch (err) {
      last = err;
    }
    await sleep(150);
  }
  throw new Error(`timed out waiting for ${label}${last ? ` (${String(last)})` : ""}; active tab: ${JSON.stringify(activeTab())}`);
}

function describeInput(input: unknown): { kind: string; viewType?: string; path?: string } {
  if (input instanceof vscode.TabInputCustom) return { kind: "custom", viewType: input.viewType, path: input.uri.fsPath };
  if (input instanceof vscode.TabInputText) return { kind: "text", path: input.uri.fsPath };
  if (input instanceof vscode.TabInputWebview) return { kind: "webview", viewType: input.viewType };
  return { kind: "other" };
}
const activeTab = () => describeInput(vscode.window.tabGroups.activeTabGroup.activeTab?.input);
const allTabs = () => vscode.window.tabGroups.all.flatMap((g) => g.tabs.map((t) => describeInput(t.input)));
const samePath = (a: string | undefined, b: vscode.Uri) => !!a && a.toLowerCase() === b.fsPath.toLowerCase();

async function step(name: string, fn: () => Promise<unknown>): Promise<void> {
  const started = Date.now();
  stepRetries = [];
  try {
    const detail = await fn();
    const skipped = typeof detail === "string" && detail.startsWith("SKIPPED");
    const retried = stepRetries.length ? { shortcutRetries: [...stepRetries] } : {};
    results.push({ name, ok: true, skipped, detail, ...retried, ms: Date.now() - started });
  } catch (err) {
    results.push({ name, ok: false, error: err instanceof Error ? (err.stack ?? err.message) : String(err), ms: Date.now() - started });
    try {
      await shot(`FAIL-${results.length}`);
    } catch {
      /* best effort */
    }
  }
  save();
}

export async function run(): Promise<void> {
  const ext = vscode.extensions.getExtension<LiveTestApi>("wikijs-style.wikijs-page-viewer");
  if (!ext) throw new Error("extension not loaded");
  const api = await ext.activate();
  if (!api) throw new Error("live-test API missing (not running in ExtensionMode.Test)");
  const paints: PaintReport[] = [];
  api.onDidPaint((p) => paints.push(p));
  const waitPaint = (kind: ViewKind, uri: vscode.Uri, from: number, ok: (p: PaintReport) => boolean = () => true) =>
    waitFor(`${kind} paint of ${path.basename(uri.fsPath)}`, () =>
      paints.slice(from).find((p) => p.kind === kind && samePath(vscode.Uri.parse(p.uri).fsPath, uri) && ok(p)),
    );
  const before = Object.fromEntries(Object.entries(PAGES).map(([k, u]) => [k, hash(u)]));
  const isOurs = (t = activeTab()) => t.kind === "custom" && !!t.viewType?.includes("wikijsViewer.page");

  const previewDefault = ASSOC === "preview";
  await step(`environment: ${vscode.env.appName} ${vscode.version}; .md opens in ${previewDefault ? "the built-in Markdown Preview" : "the text editor"} (as on the user's machine)`, async () => {
    await vscode.commands.executeCommand("vscode.open", PAGES.home);
    const t = await waitFor(previewDefault ? "built-in preview tab" : "text editor tab", () => {
      const t = activeTab();
      if (previewDefault) return t.kind === "custom" && t.viewType?.includes("markdown.preview.editor") ? t : undefined;
      return t.kind === "text" && samePath(t.path, PAGES.home) ? t : undefined;
    });
    await sleep(1500);
    await shot("01-default-markdown-editor");
    return { app: vscode.env.appName, version: vscode.version, builtInEditors: BUILT_IN_EDITORS, tab: t };
  });

  await step(`Ctrl+Shift+V in the ${previewDefault ? "built-in Markdown Preview" : "markdown text editor"} opens the Wiki.js Page`, async () => {
    const mark = paints.length;
    await shortcut("^+v", () => isOurs() && samePath(activeTab().path, PAGES.home));
    const t = await waitFor("Wiki.js Page tab", () => (isOurs() && samePath(activeTab().path, PAGES.home) ? activeTab() : undefined));
    const p = await waitPaint("editor", PAGES.home, mark);
    if (p.blocks < 10) throw new Error(`only ${p.blocks} blocks painted`);
    if (p.background !== "rgb(18, 18, 18)") throw new Error(`page background ${p.background}, wiki is rgb(18, 18, 18)`);
    if (p.calloutBackground !== "rgb(13, 71, 161)") throw new Error(`info callout ${p.calloutBackground}, wiki is rgb(13, 71, 161)`);
    await sleep(800);
    const homeTabs = vscode.window.tabGroups.activeTabGroup.tabs.filter((tb) => samePath(describeInput(tb.input).path, PAGES.home));
    if (homeTabs.length !== 1) throw new Error(`expected the tab to be replaced, found ${homeTabs.length} home.md tabs`);
    const st = await api.state("editor");
    if (st.scrollY > 5) throw new Error(`page opened scrolled to ${st.scrollY}px instead of the top; ${JSON.stringify(st.log)}`);
    await shot("02-wikijs-page-home");
    return { tab: t, paint: p };
  });

  await step(`Ctrl+Shift+V also works from the ${previewDefault ? "markdown text editor" : "built-in Markdown Preview"}`, async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    if (previewDefault) await vscode.window.showTextDocument(PAGES.home, { preview: false });
    else await vscode.commands.executeCommand("vscode.openWith", PAGES.home, "vscode.markdown.preview.editor");
    await waitFor("starting editor", () => (previewDefault ? activeTab().kind === "text" : activeTab().viewType?.includes("markdown.preview.editor")));
    await sleep(1200);
    const mark = paints.length;
    await shortcut("^+v", () => isOurs() && samePath(activeTab().path, PAGES.home));
    await waitFor("Wiki.js Page tab", () => isOurs() && samePath(activeTab().path, PAGES.home));
    const p = await waitPaint("editor", PAGES.home, mark);
    const homeTabs = vscode.window.tabGroups.activeTabGroup.tabs.filter((tb) => samePath(describeInput(tb.input).path, PAGES.home));
    if (homeTabs.length !== 1) throw new Error(`expected the tab to be replaced, found ${homeTabs.length} home.md tabs`);
    return { blocks: p.blocks };
  });

  await step("only the page body is shown, under a compact table of every frontmatter field (no site chrome)", async () => {
    const chrome = await api.query("editor", ".wk-appbar, .wk-breadcrumbs, .wk-header-band, .wk-col-sd, .page-toc-card, .page-tags-card, .page-author-card");
    if (chrome.count) throw new Error(`${chrome.count} site-chrome elements are still rendered`);
    const rows = await api.query("editor", ".wk-frontmatter .wk-fm-row");
    if (rows.count !== 7) throw new Error(`expected the 7 home.md frontmatter fields, found ${rows.count}`);
    if (rows.title !== "Demo Wiki") throw new Error(`title row shows "${rows.title}"`);
    const p = paints.filter((x) => x.kind === "editor").pop();
    if (p && p.overflowX > 1) throw new Error(`page is ${p.overflowX}px wider than the editor`);
    await shot("02c-frontmatter-table");
    return { rows: rows.count, title: rows.title, overflowX: p?.overflowX };
  });

  await step("Wiki.js Page opens at the top while the built-in preview of the same file stays open", async () => {
    // Fixed columns: built-in preview in 1, a fresh Wiki.js Page in 2 (relying on "active group"
    // raced with the preview taking focus and could re-show an existing tab instead).
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await vscode.commands.executeCommand("vscode.openWith", PAGES.home, "vscode.markdown.preview.editor", { viewColumn: vscode.ViewColumn.One });
    await sleep(1500);
    const mark = paints.length;
    await vscode.commands.executeCommand("vscode.openWith", PAGES.home, "wikijsViewer.page", { viewColumn: vscode.ViewColumn.Two });
    await waitPaint("editor", PAGES.home, mark);
    await sleep(1500);
    const st = await api.state("editor");
    await shot("02b-next-to-builtin-preview");
    if (st.scrollY > 5) throw new Error(`opened scrolled to ${st.scrollY}px; ${JSON.stringify(st.log)}`);
    await vscode.commands.executeCommand("workbench.action.closeEditorsInOtherGroups");
    return st;
  });

  await step("'Reopen Editor With' offers Wiki.js Page (visual check of screenshot)", async () => {
    void vscode.commands.executeCommand("workbench.action.reopenWithEditor");
    await sleep(1500);
    await shot("03-reopen-editor-with");
    await keys("{ESC}");
    return "see 03-reopen-editor-with.png";
  });

  await step("clicking a wiki link in the page opens that page as a Wiki.js Page", async () => {
    const mark = paints.length;
    const s = await api.click("editor", 'a[href="/guide"]');
    if (!s.clicked) throw new Error("link not found in the painted page");
    await waitFor("guide tab", () => isOurs() && samePath(activeTab().path, PAGES.drafting));
    const p = await waitPaint("editor", PAGES.drafting, mark);
    await sleep(800);
    const st = await api.state("editor");
    if (st.scrollY > 5) throw new Error(`linked page opened scrolled to ${st.scrollY}px instead of the top; ${JSON.stringify(st.log)}`);
    await shot("04-link-to-guide");
    return p;
  });

  await step("a heading's ¶ anchor scrolls to that heading", async () => {
    const mark = paints.length;
    await vscode.commands.executeCommand("vscode.openWith", PAGES.versioning, "wikijsViewer.page");
    await waitPaint("editor", PAGES.versioning, mark);
    await sleep(500);
    const top = await api.state("editor");
    const s = await api.click("editor", 'a.toc-anchor[href="#step-4-edit-the-page"]');
    if (!s.clicked) throw new Error("heading anchor not found");
    const after = await waitFor("scroll after anchor click", async () => {
      const st = await api.state("editor");
      return st.scrollY > top.scrollY + 300 ? st : undefined;
    }, 5000);
    await shot("05-anchor-scrolled");
    return { before: top.scrollY, after: after.scrollY };
  });

  await step("code block Copy puts the code on the clipboard", async () => {
    const saved = await vscode.env.clipboard.readText();
    try {
      const mark = paints.length;
      await vscode.commands.executeCommand("vscode.openWith", PAGES.guidelines, "wikijsViewer.page");
      await waitPaint("editor", PAGES.guidelines, mark);
      await vscode.env.clipboard.writeText("");
      const s = await api.click("editor", ".code-toolbar .toolbar button");
      if (!s.clicked) throw new Error("Copy button not found");
      const text = await waitFor("clipboard text", async () => {
        const t = await vscode.env.clipboard.readText();
        return t.includes("title: Clear, Descriptive Title") ? t : undefined;
      }, 5000);
      if (/^\s*1\s*2/.test(text)) throw new Error("line numbers were copied");
      return `${text.split("\n").length} lines copied`;
    } finally {
      await vscode.env.clipboard.writeText(saved);
    }
  });

  await step("Ctrl+Shift+V in a Wiki.js Page opens the markdown source beside it", async () => {
    await shortcut("^+v", () => vscode.window.visibleTextEditors.some((e) => samePath(e.document.uri.fsPath, PAGES.guidelines)));
    const ed = await waitFor("text editor for article-guidelines", () =>
      vscode.window.visibleTextEditors.find((e) => samePath(e.document.uri.fsPath, PAGES.guidelines)),
    );
    return { column: ed.viewColumn };
  });

  await step("Ctrl+K V in a markdown text editor opens the Wiki.js preview beside it", async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await vscode.window.showTextDocument(PAGES.versioning, { viewColumn: vscode.ViewColumn.One, preview: false });
    const mark = paints.length;
    await shortcut("^k|v", () => allTabs().some((t) => t.kind === "webview" && !!t.viewType?.includes("wikijsViewer.preview")));
    await waitFor("preview tab", () => allTabs().find((t) => t.kind === "webview" && t.viewType?.includes("wikijsViewer.preview")));
    const p = await waitPaint("preview", PAGES.versioning, mark);
    await sleep(800);
    await shot("06-side-by-side-preview");
    // A side panel is narrow: the page must still fit its width (no sideways scrolling).
    if (p.overflowX > 1) throw new Error(`side preview content is ${p.overflowX}px wider than the panel`);
    return p;
  });

  await step("scrolling the editor scrolls the preview", async () => {
    const editor = vscode.window.visibleTextEditors.find((e) => samePath(e.document.uri.fsPath, PAGES.versioning));
    if (!editor) throw new Error("versioning editor not visible");
    editor.revealRange(new vscode.Range(150, 0, 150, 0), vscode.TextEditorRevealType.AtTop);
    const down = await waitFor("preview scrolled down", async () => {
      const s = await api.state("preview");
      return s.scrollY > 500 ? s : undefined;
    }, 5000);
    editor.revealRange(new vscode.Range(0, 0, 0, 0), vscode.TextEditorRevealType.AtTop);
    const up = await waitFor("preview back at top", async () => {
      const s = await api.state("preview");
      return s.scrollY < 50 ? s : undefined;
    }, 5000);
    return { down: down.scrollY, up: up.scrollY };
  });

  await step("the preview follows the active markdown editor", async () => {
    const mark = paints.length;
    await vscode.window.showTextDocument(PAGES.home, { viewColumn: vscode.ViewColumn.One, preview: false });
    return waitPaint("preview", PAGES.home, mark);
  });

  await step("typing in the editor updates the preview live (then reverted, never saved)", async () => {
    const editor = await waitFor("home editor", () =>
      vscode.window.activeTextEditor && samePath(vscode.window.activeTextEditor.document.uri.fsPath, PAGES.home) ? vscode.window.activeTextEditor : undefined,
    );
    const baseline = await waitPaint("preview", PAGES.home, 0);
    const end = editor.document.lineAt(editor.document.lineCount - 1).range.end;
    editor.selection = new vscode.Selection(end, end);
    const mark = paints.length;
    try {
      await keys("{ENTER}{ENTER}LIVETEST typed by the live test");
      const p = await waitPaint("preview", PAGES.home, mark, (x) => x.blocks === baseline.blocks + 1);
      await sleep(500);
      await shot("07-live-typing");
      return { blocksBefore: baseline.blocks, blocksAfter: p.blocks };
    } finally {
      await vscode.window.showTextDocument(editor.document, { viewColumn: editor.viewColumn });
      await vscode.commands.executeCommand("workbench.action.files.revert");
      await waitFor("home.md reverted", () => !editor.document.isDirty, 5000);
    }
  });

  await step("pages still open at the top after the user taps Alt (menu bar) and presses Ctrl+Shift+V", async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await vscode.commands.executeCommand("vscode.open", PAGES.versioning);
    await waitFor("versioning in the default markdown editor", () =>
      previewDefault ? activeTab().viewType?.includes("markdown.preview.editor") : activeTab().kind === "text" && samePath(activeTab().path, PAGES.versioning),
    );
    await sleep(1200);
    await driver({ action: "alttap" });
    await sleep(300);
    await keys("{ESC}"); // leave the menu bar, as a person would; editor shortcuts need editor focus
    await sleep(300);
    const mark = paints.length;
    await shortcut("^+v", () => isOurs() && samePath(activeTab().path, PAGES.versioning));
    await waitPaint("editor", PAGES.versioning, mark);
    await sleep(1500);
    const st = await api.state("editor");
    await shot("08-after-alt-tap");
    if (st.scrollY > 5) throw new Error(`opened scrolled to ${st.scrollY}px; ${JSON.stringify(st.log)}`);
    const mark2 = paints.length;
    const folders = file("guide/folders.md");
    const s = await api.click("editor", 'a[href="/guide/folders"]');
    if (!s.clicked) throw new Error("page link not found");
    await waitPaint("editor", folders, mark2);
    await sleep(1500);
    const st2 = await api.state("editor");
    if (st2.scrollY > 5) throw new Error(`linked page opened scrolled to ${st2.scrollY}px; ${JSON.stringify(st2.log)}`);
    return { first: st.scrollY, linked: st2.scrollY };
  });

  await step("a REAL mouse click on a web link opens it exactly once (audit finding 1)", async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    const mark = paints.length;
    await vscode.commands.executeCommand("vscode.openWith", PAGES.drafting, "wikijsViewer.page");
    await waitPaint("editor", PAGES.drafting, mark);
    await sleep(800);
    // Make the link cover the whole page, then click with the real OS mouse inside the page: the
    // click is genuine (trusted) and travels the full event path, including VSCodium's own
    // window-level link handler, without depending on pixel-exact aiming (mixed-DPI monitors).
    const cover = await api.cover("editor", "a.is-external-link");
    if (!cover.clicked) throw new Error("no external link on the page");
    const before = api.externalOpens().length;
    const pointerBefore = (await api.state("editor")).lastPointer ?? [];
    const newPointer = (list: string[] = []) => list.slice(pointerBefore.length ? list.lastIndexOf(pointerBefore[pointerBefore.length - 1]) + 1 : 0);
    const points: [number, number][] = [[0.65, 0.55], [0.75, 0.45], [0.6, 0.7]];
    let used: [number, number] = points[0];
    for (const [i, p] of points.entries()) {
      used = p;
      if (i > 0) stepRetries.push(`real mouse click at another point (no trusted click reached the page)`);
      await driver({ action: "click", fx: p[0], fy: p[1] });
      await sleep(1500);
      const seen = newPointer((await api.state("editor")).lastPointer);
      if (api.externalOpens().length > before || seen.some((e) => e.startsWith("click trusted=true"))) break;
    }
    await shot("09-real-click-external-link");
    const opened = api.externalOpens().slice(before);
    const after = await api.state("editor");
    await keys("{ESC}"); // closes VSCodium's open-link dialog if the click had leaked to it
    const diag = { opened, clickedAtWindowFraction: used, pointerEventsSeen: newPointer(after.lastPointer), focusedAfter: after.focused };
    if (!diag.pointerEventsSeen.some((e) => e.startsWith("click trusted=true") && e.includes("a.is-external-link")))
      throw new Error(`no trusted click on the link reached the page; diagnostics: ${JSON.stringify(diag)}`);
    if (opened.length !== 1) throw new Error(`expected exactly one open; diagnostics: ${JSON.stringify(diag)}`);
    // VSCodium's own link handler would open a modal "open external website?" dialog, which takes
    // focus from the webview.
    if (!after.focused) throw new Error("the webview lost focus after the click: VSCodium opened the link a second time (its own dialog)");
    return diag;
  });

  await step("the HTTPS embed renders live, https-only and sandboxed", async () => {
    const mark = paints.length;
    const map = file("examples/embed.md");
    await vscode.commands.executeCommand("vscode.openWith", map, "wikijsViewer.page");
    await waitPaint("editor", map, mark);
    const q = await api.query("editor", "#wk-contents iframe", "sandbox");
    if (q.count !== 1) throw new Error(`expected 1 iframe, found ${q.count}`);
    if (q.attr !== "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation") throw new Error(`sandbox is ${q.attr}`);
    const src = await api.query("editor", "#wk-contents iframe", "src");
    if (!src.attr?.startsWith("https://example.com/")) throw new Error(`iframe src ${src.attr}`);
    await sleep(4000); // let the embed load
    await shot("10-map-embed");
    return { sandbox: q.attr, src: src.attr };
  });

  await step("embedded frames and unauthenticated messages cannot impersonate the preview host", async () => {
    const state = await api.probeMessages("editor");
    if (!state.untrustedMessagesIgnored) throw new Error("an untrusted message changed the preview");
    const heading = await api.query("editor", "#wk-contents h1");
    if (!heading.count) throw new Error("the preview disappeared during the message probe");
    return { untrustedMessagesIgnored: state.untrustedMessagesIgnored };
  });

  await step("hostile HTML in a page cannot run anything in the webview (audit finding 2)", async () => {
    const dir = path.join(OUT, "security");
    fs.mkdirSync(dir, { recursive: true });
    const page = path.join(dir, "security-test.md");
    fs.writeFileSync(
      page,
      [
        "# Security test",
        `<img src="x" onerror="window.__pwned='img'">`,
        "",
        `<iframe src="http://example.com/"></iframe>`,
        "",
        "<style>body{display:none}</style>",
        "",
        `<a id="jslink" href="javascript:window.__pwned='link'">js link</a> <form action="https://example.com"><button id="sub">go</button></form>`,
        "",
        `<svg><a id="svglink"><animate attributeName="href" values="javascript:window.__pwned='svg'"/><text y="20">svg link</text></a></svg>`,
        "",
        "Text (the mXSS payload comes last: its unclosed tags swallow everything after it)",
        "",
        `<math><mtext><table><mglyph><style><img src=x onerror="window.__pwned='mxss'"><a href="javascript:window.__pwned='js'">click</a>`,
      ].join("\n"),
    );
    const uri = vscode.Uri.file(page);
    const mark = paints.length;
    await vscode.commands.executeCommand("vscode.openWith", uri, "wikijsViewer.page");
    await waitPaint("editor", uri, mark);
    await sleep(1000);
    for (const sel of ["#jslink", "#svglink", "#sub", "#wk-contents a"]) await api.click("editor", sel);
    await sleep(800);
    const checks = {
      handlers: (await api.query("editor", "[onerror],[onload],[onclick]")).count,
      jsHrefs: (await api.query("editor", '[href^="javascript"],[values*="javascript"],[to*="javascript"]')).count,
      styleTags: (await api.query("editor", "#wk-contents style")).count,
      blockedEmbeds: (await api.query("editor", ".wk-embed-blocked")).count,
      iframes: (await api.query("editor", "#wk-contents iframe")).count,
      pwned: (await api.query("editor", "body")).pwned,
      stillVisible: (await api.query("editor", "#wk-contents h1")).count,
    };
    await shot("11-security-page");
    const bad = checks.handlers || checks.jsHrefs || checks.styleTags || checks.iframes || checks.blockedEmbeds !== 1 || checks.pwned !== "undefined" || !checks.stillVisible;
    if (bad) throw new Error(`unsafe result: ${JSON.stringify(checks)}`);
    return checks;
  });

  await step("Ctrl+Shift+V is left alone in the built-in WYSIWYG Markdown Editor", async () => {
    if (!BUILT_IN_EDITORS.includes("vscode.markdown.editor")) return `SKIPPED: ${vscode.env.appName} ${vscode.version} has no WYSIWYG Markdown Editor`;
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await vscode.commands.executeCommand("vscode.openWith", PAGES.home, "vscode.markdown.editor");
    await waitFor("built-in Markdown Editor", () => activeTab().viewType?.includes("markdown.editor"));
    await sleep(1500);
    const saved = await vscode.env.clipboard.readText();
    await vscode.env.clipboard.writeText(""); // nothing to paste if the editor treats it as paste
    try {
      await keys("^+v");
      await sleep(1200);
      const t = activeTab();
      if (isOurs(t)) throw new Error("our shortcut took over the WYSIWYG editor");
      return t;
    } finally {
      await vscode.env.clipboard.writeText(saved);
      const doc = vscode.workspace.textDocuments.find((d) => samePath(d.uri.fsPath, PAGES.home));
      if (doc?.isDirty) {
        await vscode.window.showTextDocument(doc);
        await vscode.commands.executeCommand("workbench.action.files.revert");
      }
    }
  });

  // Disposable assets outside the workspace exercise RelativePattern watches as well as real
  // disk saves. Never change the user's wiki or the tracked synthetic demo pages.
  const assetsDir = path.join(OUT, "asset-refresh");
  const assetPage = vscode.Uri.file(path.join(assetsDir, "home.md"));
  const drawing = path.join(assetsDir, "assets", "drawing [draft].svg");
  const missing = path.join(assetsDir, "assets", "new-folder", "added.svg");
  const svg = (width: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="80"><rect id="layer" width="100%" height="100%" fill="${width === 120 ? "#e8590c" : "#2f9e44"}"/><text x="8" y="45" fill="white">${width}px</text></svg>`;
  fs.mkdirSync(path.dirname(drawing), { recursive: true });
  fs.writeFileSync(drawing, svg(120));
  fs.writeFileSync(assetPage.fsPath, [
    "---", "title: Asset refresh test", "---", "# Local SVG refresh", "",
    '<img id="live-svg" src="/assets/drawing%20%5Bdraft%5D.svg#layer" width="320" height="80">', "",
    '<details id="refresh-details"><summary>Keep this section open</summary><p>Expanded state survives refresh.</p></details>', "",
    '<img id="added-svg" src="/assets/new-folder/added.svg" width="80" height="80">', "",
    ...Array.from({ length: 35 }, (_, i) => `## Reading section ${i + 1}\n\nText to keep a stable reading position while assets refresh.\n`),
  ].join("\n"));
  const waitImage = (kind: ViewKind, selector: string, width: number) => waitFor(`loaded ${width}px SVG in ${kind}`, async () => {
    const q = await api.query(kind, selector, "src");
    return q.image?.complete && q.image.width === width ? q : undefined;
  });

  await step("saving or replacing a local SVG refreshes the Wiki.js Page and recovers missing assets", async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    const mark = paints.length;
    await vscode.commands.executeCommand("vscode.openWith", assetPage, "wikijsViewer.page");
    await waitPaint("editor", assetPage, mark);
    const before = await waitImage("editor", "#live-svg", 120);
    if (!before.attr?.endsWith("#layer")) throw new Error("SVG fragment was lost");
    await api.click("editor", "#refresh-details summary");
    fs.writeFileSync(drawing, svg(240));
    const after = await waitImage("editor", "#live-svg", 240);
    if (before.attr === after.attr) throw new Error("asset URL did not change");
    const replacement = drawing + ".tmp";
    fs.writeFileSync(replacement, svg(180));
    fs.renameSync(replacement, drawing);
    await waitImage("editor", "#live-svg", 180);
    fs.mkdirSync(path.dirname(missing), { recursive: true });
    fs.writeFileSync(missing, svg(80));
    await waitImage("editor", "#added-svg", 80);
    if ((await api.query("editor", "#refresh-details[open]")).count !== 1) throw new Error("expanded section closed during asset refresh");
    await shot("12-svg-auto-refresh");
    return { before: before.image, after: after.image, atomicReplacementWidth: 180, missingAssetRecovered: true };
  });

  await step("Refresh Wiki.js Page command and Ctrl+Shift+R re-fetch assets without losing scroll or details", async () => {
    // Title action is visible in the screenshots; the command it invokes runs here, followed
    // by the real keyboard shortcut to verify contribution scope and webview focus handling.
    const before = await waitImage("editor", "#live-svg", 180);
    let mark = paints.length;
    await vscode.commands.executeCommand("wikijsViewer.refresh");
    await waitPaint("editor", assetPage, mark);
    const command = await waitImage("editor", "#live-svg", 180);
    if (command.attr === before.attr) throw new Error("refresh command reused the cached URL");
    await api.click("editor", 'a.toc-anchor[href="#reading-section-15"]');
    const position = await waitFor("reading position", async () => {
      const s = await api.state("editor");
      return s.scrollY > 500 ? s : undefined;
    });
    await sleep(500); // allow smooth anchor scrolling to finish
    const settled = await api.state("editor");
    await driver({ action: "click", fx: 0.7, fy: 0.5 });
    await waitFor("Wiki.js Page keyboard focus", async () => (await api.state("editor")).focused);
    mark = paints.length;
    await shortcut("^+r", () => paints.slice(mark).some(p => p.kind === "editor" && samePath(vscode.Uri.parse(p.uri).fsPath, assetPage)));
    await waitPaint("editor", assetPage, mark);
    const keyboard = await waitImage("editor", "#live-svg", 180);
    const after = await api.state("editor");
    if (keyboard.attr === command.attr) throw new Error("Ctrl+Shift+R did not re-fetch the asset");
    if (Math.abs(after.scrollY - settled.scrollY) > 5) throw new Error(`refresh moved reading position: ${settled.scrollY} -> ${after.scrollY}`);
    if ((await api.query("editor", "#refresh-details[open]")).count !== 1) throw new Error("refresh collapsed details");
    await shot("13-manual-refresh-position");
    return { initialScroll: position.scrollY, before: settled.scrollY, after: after.scrollY };
  });

  await step("side preview refreshes saved SVGs and Ctrl+Shift+R works with the preview focused", async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await vscode.window.showTextDocument(assetPage, { viewColumn: vscode.ViewColumn.One, preview: false });
    const mark = paints.length;
    await vscode.commands.executeCommand("wikijsViewer.openToSide", assetPage);
    await waitPaint("preview", assetPage, mark);
    await waitImage("preview", "#live-svg", 180);
    fs.writeFileSync(drawing, svg(300));
    const auto = await waitImage("preview", "#live-svg", 300);
    // editor/title supplies this synthetic resource, even when the Markdown group is active.
    const titleMark = paints.length;
    await vscode.commands.executeCommand("wikijsViewer.refresh", vscode.Uri.parse("webview-panel:/webview-panel/live-preview"));
    await waitPaint("preview", assetPage, titleMark);
    const titleRefresh = await waitImage("preview", "#live-svg", 300);
    if (titleRefresh.attr === auto.attr) throw new Error("side-preview title action reused the asset URL");
    await vscode.commands.executeCommand("workbench.action.focusSecondEditorGroup");
    await sleep(500);
    await driver({ action: "click", fx: 0.85, fy: 0.6 });
    await waitFor("side preview keyboard focus", async () => (await api.state("preview")).focused);
    const refreshMark = paints.length;
    await shortcut("^+r", () => paints.slice(refreshMark).some(p => p.kind === "preview" && samePath(vscode.Uri.parse(p.uri).fsPath, assetPage)));
    await waitPaint("preview", assetPage, refreshMark);
    const manual = await waitImage("preview", "#live-svg", 300);
    if (manual.attr === titleRefresh.attr) throw new Error("side-preview Ctrl+Shift+R reused the asset URL");
    await shot("14-side-preview-refresh");
    return { loaded: manual.image, shortcutRefreshed: true };
  });

  const editDir = path.join(OUT, "block-editing");
  const editPage = vscode.Uri.file(path.join(editDir, "home.md"));
  const originalEditSource = ["---", "title: Editing example", "tags: keep, these", "---", "", "# Editing", "", "Editable **paragraph**.", "", "> Original quote", "{.is-info}", "", "- [ ] Task one", "- [x] Task two", "", '<div id="html-object"><strong>Original HTML</strong></div>', "", '<input id="html-checkbox" type="checkbox">', "", '<iframe id="editable-frame" src="https://example.com" width="500" height="180"></iframe>', "", "Final untouched paragraph.", ""].join("\n");
  fs.mkdirSync(editDir, { recursive: true });
  fs.writeFileSync(editPage.fsPath, originalEditSource);
  let editDoc: vscode.TextDocument;
  const editorText = ".wk-block-editor textarea";
  const applyButton = '.wk-block-editor [data-action="apply"]';
  const cancelButton = '.wk-block-editor [data-action="cancel"]';
  const fill = async (kind: ViewKind, text: string) => {
    await waitFor("block editor", async () => (await api.query(kind, editorText)).count === 1);
    await api.input(kind, editorText, text);
  };
  const apply = async (kind: ViewKind, expected: string) => {
    const mark = paints.length;
    await api.click(kind, applyButton);
    await waitFor("edited document buffer", () => editDoc.getText().includes(expected));
    await waitPaint(kind, editPage, mark);
    await waitFor("closed block editor", async () => (await api.query(kind, editorText)).count === 0);
  };

  await step("text block Cancel leaves source untouched; Apply updates the buffer and native Undo restores it", async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    editDoc = await vscode.workspace.openTextDocument(editPage);
    const mark = paints.length;
    await vscode.commands.executeCommand("vscode.openWith", editPage, "wikijsViewer.page");
    await waitPaint("editor", editPage, mark);
    await api.click("editor", "#wk-contents > p", { double: true });
    await fill("editor", "Discard this draft.");
    await api.click("editor", cancelButton);
    if (editDoc.getText() !== originalEditSource) throw new Error("Cancel changed the document");
    await api.click("editor", "#wk-contents > p", { double: true });
    await fill("editor", "Edited **paragraph**.");
    await shot("15-text-block-editor");
    // Real keyboard focus + Ctrl+Enter exercises the textarea shortcut in the editor webview.
    await driver({ action: "click", fx: 0.7, fy: 0.55 });
    await api.click("editor", "#wk-contents > p", { double: true }); // focuses the existing draft
    await waitFor("editing keyboard focus", async () => (await api.state("editor")).focused);
    const applyMark = paints.length;
    await keys("^{ENTER}");
    await waitFor("keyboard Apply", () => editDoc.getText().includes("Edited **paragraph**."));
    await waitPaint("editor", editPage, applyMark);
    if (!editDoc.isDirty || fs.readFileSync(editPage.fsPath, "utf8") !== originalEditSource) throw new Error("Apply must update the buffer without implicitly saving");
    const undoMark = paints.length;
    await vscode.commands.executeCommand("undo");
    await waitFor("native document Undo", () => editDoc.getText() === originalEditSource);
    await waitPaint("editor", editPage, undoMark);
    return "Apply and Undo changed only the paragraph; disk content unchanged";
  });

  await step("editable task and HTML checkboxes retain Wiki.js sizing and appearance", async () => {
    for (const selector of ['.task-list-item-checkbox', '#html-checkbox']) {
      const { rect } = await api.locate("editor", selector);
      if (!rect || rect.width < 17 || rect.height < 17) throw new Error(`${selector} fell back to a small native checkbox: ${JSON.stringify(rect)}`);
      if ((await api.query("editor", `${selector}:disabled`)).count !== 0) throw new Error(`${selector} is not interactive`);
    }
    await shot("15b-wikijs-checkbox-appearance");
    return "Wiki.js size retained; unchecked/checked colors and checkmarks require screenshot inspection";
  });

  await step("task and HTML checkboxes update their source, and quote blocks retain Wiki.js attributes", async () => {
    const mark = paints.length;
    await api.click("editor", '.task-list-item-checkbox');
    await waitFor("checked Markdown marker", () => editDoc.getText().includes("- [x] Task one"));
    await waitPaint("editor", editPage, mark);
    const htmlMark = paints.length;
    await api.click("editor", '#html-checkbox');
    await waitFor("checked HTML attribute", () => /id="html-checkbox"[^>]* checked/.test(editDoc.getText()));
    await waitPaint("editor", editPage, htmlMark);
    await api.click("editor", "blockquote", { double: true });
    const source = (await api.query("editor", editorText)).value;
    if (source !== "> Original quote\n{.is-info}") throw new Error(`wrong quote source: ${source}`);
    await fill("editor", "> Revised quote\n{.is-warning}");
    await apply("editor", "> Revised quote\n{.is-warning}");
    if ((await api.query("editor", "blockquote.is-warning")).count !== 1) throw new Error("quote style did not update");
    await shot("16-checkboxes-and-quote");
  });

  await step("Shift-click edits HTML objects; the compact attributes and embedded-frame actions apply exact source changes", async () => {
    await api.click("editor", "#html-object", { shiftKey: true });
    await fill("editor", '<div id="html-object"><em>Revised HTML</em></div>');
    await shot("17-html-object-editor");
    await apply("editor", '<em>Revised HTML</em>');
    await api.click("editor", ".wk-edit-attributes");
    await fill("editor", "---\ntitle: Revised title\ntags: keep, these\n---");
    await apply("editor", "title: Revised title");
    if ((await api.state("editor")).title !== "Revised title") throw new Error("compact title did not update");
    await api.click("editor", ".wk-edit-frame");
    await fill("editor", '<iframe id="editable-frame" src="https://example.com" width="500" height="140" title="Edited frame"></iframe>');
    await apply("editor", 'title="Edited frame"');
    if ((await api.query("editor", "#editable-frame", "sandbox")).attr?.includes("allow-top-navigation")) throw new Error("edited embed lost its sandbox");
    await shot("18-attributes-and-html-result");
  });

  await step("background changes cannot overwrite a draft; stale Apply is rejected without losing text", async () => {
    await api.click("editor", "#wk-contents > p", { double: true });
    await fill("editor", "Draft to keep.");
    const external = new vscode.WorkspaceEdit();
    external.insert(editDoc.uri, editDoc.positionAt(editDoc.getText().length), "\nConcurrent source edit.\n");
    await vscode.workspace.applyEdit(external);
    await sleep(500);
    await api.click("editor", applyButton);
    await waitFor("visible stale-edit error", async () => /changed|no longer/.test((await api.query("editor", ".wk-edit-error")).text ?? ""));
    if ((await api.query("editor", editorText)).value !== "Draft to keep.") throw new Error("conflict lost the draft");
    if (editDoc.getText().includes("Draft to keep.") || !editDoc.getText().includes("Concurrent source edit.")) throw new Error("stale draft overwrote source");
    await shot("19-preserved-conflicting-draft");
    await api.click("editor", cancelButton);
  });

  await step("the side preview can edit and cancel blocks; Save persists only the applied document", async () => {
    await vscode.window.showTextDocument(editDoc, { viewColumn: vscode.ViewColumn.One, preview: false });
    const mark = paints.length;
    await vscode.commands.executeCommand("wikijsViewer.openToSide", editPage);
    await waitPaint("preview", editPage, mark);
    await api.click("preview", "#wk-contents > p", { double: true });
    await fill("preview", "Side preview **edit**.");
    await apply("preview", "Side preview **edit**.");
    if (!editDoc.getText().includes("Final untouched paragraph.")) throw new Error("unrelated content changed");
    await api.click("preview", ".wk-edit-attributes");
    await fill("preview", "---\ntitle: Cancelled\n---");
    await api.click("preview", cancelButton);
    if (editDoc.getText().includes("Cancelled")) throw new Error("side preview Cancel changed attributes");
    await shot("20-side-preview-editing");
    await editDoc.save();
    if (fs.readFileSync(editPage.fsPath, "utf8") !== editDoc.getText()) throw new Error("Save did not persist applied edits");
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  // A failed editing step must not leave a disposable dirty buffer that triggers a save prompt.
  for (const doc of vscode.workspace.textDocuments.filter(d => samePath(d.uri.fsPath, editPage) && d.isDirty)) {
    await vscode.window.showTextDocument(doc);
    await vscode.commands.executeCommand("workbench.action.files.revert");
  }

  await step("vault files are byte-identical after the run", async () => {
    const changed = Object.entries(PAGES).filter(([k, u]) => hash(u) !== before[k]);
    const dirty = vscode.workspace.textDocuments.filter((d) => d.isDirty).map((d) => d.uri.fsPath);
    if (changed.length || dirty.length) throw new Error(`changed: ${changed.map(([k]) => k).join(", ")}; dirty: ${dirty.join(", ")}`);
    return "unchanged";
  });

  save();
  const failed = results.filter((r) => !r.ok);
  if (failed.length) throw new Error(`${failed.length} of ${results.length} live checks failed`);
}
