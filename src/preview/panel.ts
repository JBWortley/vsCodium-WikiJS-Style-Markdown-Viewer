import * as vscode from "vscode";
import path from "node:path";
import crypto from "node:crypto";
import { RenderService } from "./renderService";
import { AssetWatcher } from "./assetWatcher";
import { fileForPage, findWikiRoot, pagePathFor, scanPages } from "./wikiRoot";
import { classifyLinkTarget } from "../render/paths";
import type { FromWebview, ToWebview } from "../render/protocol";
import type { MarkdownOptions } from "../render/markdown";
import { prepareEdit, type EditRequest, type EditSnapshot } from "../editing/edits";

/** Side panel that follows the active markdown editor. */
export const PREVIEW_VIEW_TYPE = "wikijsViewer.preview";
/** Custom editor ("Wiki.js Page" in the editor switcher / Reopen Editor With). */
export const EDITOR_VIEW_TYPE = "wikijsViewer.page";

const RENDER_DEBOUNCE_MS = 150;
const MAX_SOURCE_CHARS = 2_000_000;

interface Settings {
  wikiRoot: string;
  siteUrl: string;
  markdown: MarkdownOptions;
}

function readSettings(): Settings {
  const c = vscode.workspace.getConfiguration("wikijsViewer");
  return {
    wikiRoot: c.get("wikiRoot", ""),
    siteUrl: c.get("siteUrl", ""),
    markdown: {
      breaks: c.get("markdown.breaks", true),
      typographer: c.get("markdown.typographer", true),
      linkify: c.get("markdown.linkify", true),
    },
  };
}

/** Page indexes per wiki root, rebuilt when markdown files are created or deleted. */
class PageIndex implements vscode.Disposable {
  private readonly cache = new Map<string, Promise<string[]>>();
  private readonly watchers = new Map<string, vscode.FileSystemWatcher>();
  private readonly changed = new vscode.EventEmitter<string>();
  readonly onDidChange = this.changed.event;
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly log: (line: string) => void) {}

  get(root: string): Promise<string[]> {
    let entry = this.cache.get(root);
    if (!entry) {
      const started = Date.now();
      entry = scanPages(root).then((pages) => {
        this.log(`indexed ${pages.length} pages under ${root} in ${Date.now() - started} ms`);
        return pages;
      });
      this.cache.set(root, entry);
      this.watch(root);
    }
    return entry;
  }

  private watch(root: string): void {
    if (this.watchers.has(root)) return;
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(root), "**/*.md"), false, true, false);
    const invalidate = () => {
      clearTimeout(this.timers.get(root));
      this.timers.set(
        root,
        setTimeout(() => {
          this.cache.delete(root);
          this.changed.fire(root);
        }, 500),
      );
    };
    watcher.onDidCreate(invalidate);
    watcher.onDidDelete(invalidate);
    this.watchers.set(root, watcher);
  }

  dispose(): void {
    for (const w of this.watchers.values()) w.dispose();
    for (const t of this.timers.values()) clearTimeout(t);
    this.changed.dispose();
  }
}

/** State shared by every Wiki.js view: one render worker, one page index, one log. */
export class WikiServices implements vscode.Disposable {
  readonly renderer: RenderService;
  readonly index: PageIndex;
  private readonly painted = new vscode.EventEmitter<PaintReport>();
  /** Fires when a webview reports what it painted (log + live test). */
  readonly onDidPaint = this.painted.event;
  /** Open views, newest last (the live test addresses them by kind). */
  readonly views = new Set<WikiView>();
  firePainted(e: PaintReport): void {
    this.log(`painted ${e.kind} ${path.basename(vscode.Uri.parse(e.uri).fsPath)}: ${e.blocks} blocks, ${e.height}px tall`);
    this.painted.fire(e);
  }
  /** Anchor to scroll to once the view for this document URI renders (`/page#heading` links). */
  readonly pendingAnchors = new Map<string, string>();
  /** Live test only: when set, external links are recorded here instead of opened. */
  externalOpens?: string[];

  constructor(
    readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
  ) {
    this.renderer = new RenderService(context.extensionPath, (l) => this.log(l));
    this.index = new PageIndex((l) => this.log(l));
  }

  log(line: string): void {
    this.output.appendLine(`[${new Date().toLocaleTimeString()}] ${line}`);
  }

  dispose(): void {
    this.renderer.dispose();
    this.index.dispose();
    this.painted.dispose();
  }
}

type Navigate = (target: vscode.Uri, view: WikiView) => Promise<void>;
export type ViewKind = "editor" | "preview";
export type PaintReport = Extract<FromWebview, { type: "painted" }> & { kind: ViewKind };
type TestState = Extract<FromWebview, { type: "test:state" }>;

/** One webview showing one wiki page at a time. */
export class WikiView implements vscode.Disposable {
  doc?: vscode.TextDocument;
  private root?: string;
  private renderTimer?: NodeJS.Timeout;
  private renderSeq = 0;
  private ready = false;
  private disposed = false;
  private editKey = crypto.randomBytes(16).toString("hex");
  private editSnapshot?: EditSnapshot;
  private applyingEdit = false;
  private assetCacheKey = crypto.randomBytes(8).toString("hex");
  private readonly assets = new AssetWatcher(() => this.refresh());
  private readonly messageToken = crypto.randomBytes(32).toString("hex");
  private readonly disposables: vscode.Disposable[] = [];
  private testWaiters: ((state: TestState) => void)[] = [];

  constructor(
    private readonly services: WikiServices,
    readonly panel: vscode.WebviewPanel,
    readonly kind: ViewKind,
    private readonly navigate: Navigate,
  ) {
    services.views.add(this);
    panel.webview.options = this.webviewOptions();
    panel.webview.html = this.shellHtml();
    this.disposables.push(
      panel.webview.onDidReceiveMessage((msg: FromWebview) => this.onMessage(msg)),
      // Hidden webviews are torn down (no retainContextWhenHidden); the reloaded script sends "ready".
      panel.onDidChangeViewState(() => {
        if (!panel.visible) this.ready = false;
      }),
      services.index.onDidChange((root) => root === this.root && this.scheduleRender(0)),
      vscode.workspace.onDidChangeTextDocument((e) => e.document === this.doc && this.scheduleRender()),
      vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
        if (e.textEditor.document === this.doc && e.visibleRanges.length) this.post({ type: "scrollToLine", line: e.visibleRanges[0].start.line });
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        // A changed wikiRoot moves the root (and the webview's file access), not just the render.
        if (e.affectsConfiguration("wikijsViewer.wikiRoot") && this.doc) void this.setDocument(this.doc);
        else if (e.affectsConfiguration("wikijsViewer")) this.scheduleRender(0);
      }),
    );
  }

  async setDocument(doc: vscode.TextDocument): Promise<void> {
    if (this.disposed) return;
    if (doc !== this.doc) {
      this.editKey = crypto.randomBytes(16).toString("hex");
      this.editSnapshot = undefined;
      this.assets.update(undefined, []);
      this.assetCacheKey = crypto.randomBytes(8).toString("hex");
    }
    ++this.renderSeq;
    this.doc = doc;
    const settings = readSettings();
    const folder = vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath;
    const root = doc.uri.scheme === "file" ? findWikiRoot(doc.uri.fsPath, settings.wikiRoot, folder) : undefined;
    if (root !== this.root) {
      this.assets.update(undefined, []);
      this.assetCacheKey = crypto.randomBytes(8).toString("hex");
      this.root = root;
      this.services.log(`wiki root: ${root ?? "(none: unsaved document)"}`);
    }
    // Assigning options reloads the webview; only do it when the allowed folders change.
    const options = this.webviewOptions();
    if (JSON.stringify(options) !== JSON.stringify(this.panel.webview.options)) this.panel.webview.options = options;
    await this.renderNow();
  }

  private webviewOptions(): vscode.WebviewOptions {
    const ext = this.services.context.extensionUri;
    const roots = [vscode.Uri.joinPath(ext, "media"), vscode.Uri.joinPath(ext, "dist")];
    if (this.root) roots.push(vscode.Uri.file(this.root));
    if (this.doc?.uri.scheme === "file") roots.push(vscode.Uri.file(path.dirname(this.doc.uri.fsPath)));
    return { enableScripts: true, enableCommandUris: false, localResourceRoots: roots };
  }

  private shellHtml(): string {
    const webview = this.panel.webview;
    const ext = this.services.context.extensionUri;
    const nonce = crypto.randomBytes(16).toString("base64");
    const css = webview.asWebviewUri(vscode.Uri.joinPath(ext, "media", "wiki.css"));
    const js = webview.asWebviewUri(vscode.Uri.joinPath(ext, "dist", "preview.js"));
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} https: data:`,
      `media-src ${webview.cspSource} https:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      // Embeds (maps, video): https only; the webview sanitizer also sandboxes every iframe.
      "frame-src https:",
      "form-action 'none'",
      "base-uri 'none'",
      `script-src 'nonce-${nonce}'`,
    ].join("; ");
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${css}"></head>
<body><div id="wk-root" data-message-token="${this.messageToken}" data-test-mode="${this.services.context.extensionMode === vscode.ExtensionMode.Test}"></div><script nonce="${nonce}" src="${js}"></script></body></html>`;
  }

  scheduleRender(delay = RENDER_DEBOUNCE_MS): void {
    if (this.disposed) return;
    ++this.renderSeq;
    clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(() => void this.renderNow(), delay);
  }

  /** Re-fetch local resources without reloading the webview or losing reading state. */
  refresh(): void {
    this.assetCacheKey = crypto.randomBytes(8).toString("hex");
    this.scheduleRender();
  }

  private async renderNow(): Promise<void> {
    const { panel, doc } = this;
    if (this.disposed || !doc || !this.ready || !panel.visible) return;
    const seq = ++this.renderSeq;
    const settings = readSettings();
    const source = doc.getText();
    const version = doc.version;
    if (source.length > MAX_SOURCE_CHARS) {
      this.post({ type: "renderError", message: `This page is larger than ${MAX_SOURCE_CHARS.toLocaleString()} characters and was not rendered.` });
      return;
    }
    try {
      const root = this.root ?? path.dirname(doc.uri.fsPath);
      if (this.root) this.services.renderer.setIndex(this.root, await this.services.index.get(this.root));
      const { localAssets = [], ...page } = await this.services.renderer.render({
        source,
        pagePath: doc.uri.scheme === "file" ? pagePathFor(doc.uri.fsPath, root) : "untitled",
        siteUrl: settings.siteUrl,
        markdown: settings.markdown,
        editKey: `${this.editKey}-${version}`,
        assets: {
          rootFsPath: root,
          rootUri: panel.webview.asWebviewUri(vscode.Uri.file(root)).toString().replace(/\/+$/, ""),
          docDirFsPath: doc.uri.scheme === "file" ? path.dirname(doc.uri.fsPath) : root,
          cacheKey: this.assetCacheKey,
        },
      });
      if (this.disposed || seq !== this.renderSeq || doc !== this.doc || version !== doc.version) return;
      this.assets.update(this.root, localAssets);
      this.editSnapshot = { uri: doc.uri.toString(), version, source, targets: page.editTargets ?? [] };
      this.post({ type: "render", uri: doc.uri.toString(), page });
      this.services.log(`rendered ${page.pagePath} in ${page.renderMs} ms`);
      const anchor = this.services.pendingAnchors.get(doc.uri.toString());
      if (anchor) {
        this.services.pendingAnchors.delete(doc.uri.toString());
        this.post({ type: "scrollToAnchor", id: anchor });
      }
    } catch (err) {
      if (seq !== this.renderSeq) return;
      const message = err instanceof Error ? err.message : String(err);
      this.services.log(`render failed: ${message}`);
      this.post({ type: "renderError", message });
    }
  }

  private post(message: ToWebview): void {
    if (this.ready) void this.panel.webview.postMessage({ ...message, token: this.messageToken });
  }

  private async onMessage(msg: FromWebview): Promise<void> {
    if (msg.type === "ready") {
      this.ready = true;
      await this.renderNow();
      return;
    }
    if (msg.type === "refresh") this.refresh();
    if (msg.type === "edit") await this.applyBlockEdit(msg);
    if (msg.type === "link") await this.followLink(msg.href);
    if (msg.type === "painted") this.services.firePainted({ ...msg, kind: this.kind });
    if (msg.type === "copy") {
      await vscode.env.clipboard.writeText(msg.text);
      this.services.log(`copied ${msg.text.length} characters of code`);
    }
    if (msg.type === "test:state") for (const resolve of this.testWaiters.splice(0)) resolve(msg);
  }

  private async applyBlockEdit(request: EditRequest): Promise<void> {
    if (!request || typeof request.id !== "string") return;
    try {
      if (this.applyingEdit) throw new Error("Another change is being applied. Try again in a moment.");
      const doc = this.doc;
      const snapshot = this.editSnapshot;
      if (!doc || !snapshot || this.disposed || doc.isClosed) throw new Error("This document is no longer open.");
      const change = prepareEdit(snapshot, { uri: doc.uri.toString(), version: doc.version, source: doc.getText() }, request);
      const edit = new vscode.WorkspaceEdit();
      edit.replace(doc.uri, new vscode.Range(doc.positionAt(change.start), doc.positionAt(change.end)), change.text);
      this.applyingEdit = true;
      let ok: boolean;
      try { ok = await vscode.workspace.applyEdit(edit); }
      finally { this.applyingEdit = false; }
      if (!ok) throw new Error("The editor could not apply this change. Your draft has been kept.");
      this.post({ type: "editResult", id: request.id, ok: true });
      this.scheduleRender(0);
    } catch (error) {
      this.post({ type: "editResult", id: request.id, ok: false, message: error instanceof Error ? error.message : String(error) });
    }
  }

  /** Navigates like the wiki would, without ever handing a local file to the OS shell. */
  private async followLink(href: string): Promise<void> {
    const doc = this.doc;
    if (!doc) return;
    const settings = readSettings();
    const root = this.root ?? path.dirname(doc.uri.fsPath);
    const target = classifyLinkTarget(href, settings.siteUrl, pagePathFor(doc.uri.fsPath, root));
    switch (target.kind) {
      case "anchor":
        this.post({ type: "scrollToAnchor", id: target.id });
        return;
      case "external":
        // Live test: record instead of launching the browser.
        if (this.services.externalOpens) this.services.externalOpens.push(target.url);
        else await vscode.env.openExternal(vscode.Uri.parse(target.url));
        return;
      case "ignored":
        this.services.log(`link not followed (${target.reason}): ${href}`);
        return;
      case "asset": {
        const base = target.fromRoot ? root : path.dirname(doc.uri.fsPath);
        const file = path.resolve(base, target.relativePath);
        if (!isInside(root, file)) {
          void vscode.window.showWarningMessage(`Link points outside the wiki root: ${href}`);
          return;
        }
        await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(file), { viewColumn: vscode.ViewColumn.Beside, preview: true });
        return;
      }
      case "page": {
        // parseWikiPath already drops "."/".." segments; the containment check is a second guard.
        const file = fileForPage(root, target.pagePath);
        if (file && !isInside(root, file)) {
          void vscode.window.showWarningMessage(`Link points outside the wiki root: ${href}`);
          return;
        }
        if (!file) {
          void vscode.window.showWarningMessage(`Wiki page not found in ${root}: /${target.pagePath}`);
          return;
        }
        const uri = vscode.Uri.file(file);
        if (target.hash) this.services.pendingAnchors.set(uri.toString(), target.hash);
        await this.navigate(uri, this);
        return;
      }
    }
  }

  /** Live test: click an element inside the webview, or read its scroll state. */
  testRequest(message: Extract<ToWebview, { type: `test:${string}` }>): Promise<TestState> {
    return new Promise<TestState>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`webview did not answer ${message.type}`)), 5000);
      this.testWaiters.push((state) => {
        clearTimeout(timer);
        resolve(state);
      });
      this.post(message);
    });
  }

  dispose(): void {
    this.disposed = true;
    ++this.renderSeq;
    this.assets.dispose();
    clearTimeout(this.renderTimer);
    this.services.views.delete(this);
    for (const d of this.disposables) d.dispose();
  }
}

function isInside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return !!relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/** "Wiki.js Page": a custom editor for markdown files; links open the next page in place. */
export class WikiPageEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly services: WikiServices) {}

  async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
    const view = new WikiView(this.services, panel, "editor", async (target, from) => {
      await vscode.commands.executeCommand("vscode.openWith", target, EDITOR_VIEW_TYPE, {
        viewColumn: from.panel.viewColumn ?? vscode.ViewColumn.Active,
        preview: true,
      });
    });
    panel.onDidDispose(() => view.dispose());
    await view.setDocument(document);
  }
}

/** The side preview: a single panel that follows whichever markdown text editor is active. */
export class FollowingPreview implements vscode.Disposable {
  private view?: WikiView;
  private sourceColumn?: vscode.ViewColumn;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly services: WikiServices) {
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (this.view && editor && editor.document.languageId === "markdown") {
          this.sourceColumn = editor.viewColumn;
          if (editor.document !== this.view.doc) void this.show(editor.document);
        }
      }),
    );
  }

  async open(uri: vscode.Uri): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = vscode.window.activeTextEditor;
    if (editor?.document === doc) this.sourceColumn = editor.viewColumn;
    if (this.view) this.view.panel.reveal(vscode.ViewColumn.Beside, true);
    else this.adopt(vscode.window.createWebviewPanel(PREVIEW_VIEW_TYPE, "Wiki.js Preview", { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableFindWidget: true }));
    await this.show(doc);
  }

  adopt(panel: vscode.WebviewPanel): WikiView {
    panel.iconPath = vscode.Uri.joinPath(this.services.context.extensionUri, "media", "icon.svg");
    const view = new WikiView(this.services, panel, "preview", async (target) => {
      const next = await vscode.workspace.openTextDocument(target);
      if (this.sourceColumn !== undefined && this.sourceColumn !== panel.viewColumn) {
        await vscode.window.showTextDocument(next, { viewColumn: this.sourceColumn, preview: true, preserveFocus: true });
      }
      await this.show(next);
    });
    panel.onDidDispose(() => {
      view.dispose();
      if (this.view === view) this.view = undefined;
    });
    this.view = view;
    return view;
  }

  async restore(panel: vscode.WebviewPanel, state: { uri?: string } | undefined): Promise<void> {
    const view = this.adopt(panel);
    if (!state?.uri) return;
    try {
      await this.show(await vscode.workspace.openTextDocument(vscode.Uri.parse(state.uri)), view);
    } catch {
      panel.dispose();
    }
  }

  private async show(doc: vscode.TextDocument, view = this.view): Promise<void> {
    if (!view) return;
    view.panel.title = `Wiki: ${path.basename(doc.fileName, path.extname(doc.fileName))}`;
    await view.setDocument(doc);
  }

  dispose(): void {
    this.view?.panel.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
