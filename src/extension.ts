import * as vscode from "vscode";
import { refreshViews } from "./preview/refresh";
import { EDITOR_VIEW_TYPE, FollowingPreview, PREVIEW_VIEW_TYPE, WikiPageEditorProvider, WikiServices, type ViewKind, type WikiView } from "./preview/panel";

/** API returned from activate() only when running under the live test (ExtensionMode.Test). */
export interface LiveTestApi {
  onDidPaint: WikiServices["onDidPaint"];
  click(kind: ViewKind, selector: string): ReturnType<WikiView["testRequest"]>;
  state(kind: ViewKind): ReturnType<WikiView["testRequest"]>;
  probeMessages(kind: ViewKind): ReturnType<WikiView["testRequest"]>;
  locate(kind: ViewKind, selector: string): ReturnType<WikiView["testRequest"]>;
  cover(kind: ViewKind, selector: string): ReturnType<WikiView["testRequest"]>;
  query(kind: ViewKind, selector: string, attr?: string): ReturnType<WikiView["testRequest"]>;
  /** External links clicked since the API was created (recorded, never opened). */
  externalOpens(): string[];
}

const MARKDOWN_FILE = /\.(md|markdown|mdown|mkd|mkdn)$/i;

/**
 * The markdown file behind the active tab, whether it is shown in a text editor, VSCodium's
 * built-in Markdown Preview/Editor (custom editors), or our own Wiki.js Page view.
 */
function activeMarkdownUri(): vscode.Uri | undefined {
  const editor = vscode.window.activeTextEditor;
  if (editor?.document.languageId === "markdown") return editor.document.uri;
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom) {
    if (MARKDOWN_FILE.test(input.uri.path)) return input.uri;
  }
  return undefined;
}

function needMarkdown(uri: vscode.Uri | undefined): vscode.Uri | undefined {
  const target = uri instanceof vscode.Uri ? uri : activeMarkdownUri();
  if (!target) void vscode.window.showInformationMessage("Open a markdown page first.");
  return target;
}

export function activate(context: vscode.ExtensionContext): LiveTestApi | undefined {
  const output = vscode.window.createOutputChannel("Wiki.js Viewer");
  const services = new WikiServices(context, output);
  const preview = new FollowingPreview(services);

  context.subscriptions.push(
    output,
    services,
    preview,
    vscode.window.registerCustomEditorProvider(EDITOR_VIEW_TYPE, new WikiPageEditorProvider(services), {
      webviewOptions: { enableFindWidget: true },
      supportsMultipleEditorsPerDocument: true,
    }),
    // Reopen the current page as a Wiki.js Page in the same tab.
    vscode.commands.registerCommand("wikijsViewer.open", async (uri?: vscode.Uri) => {
      const target = needMarkdown(uri);
      if (!target) return;
      // Like "Reopen Editor With": replace the tab showing this file instead of adding a second one.
      const group = vscode.window.tabGroups.activeTabGroup;
      const previous = group.activeTab;
      const input = previous?.input;
      const sameFile = (input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom) && input.uri.toString() === target.toString();
      await vscode.commands.executeCommand("vscode.openWith", target, EDITOR_VIEW_TYPE, { viewColumn: group.viewColumn });
      if (previous && sameFile && !previous.isDirty && !(input instanceof vscode.TabInputCustom && input.viewType === EDITOR_VIEW_TYPE)) {
        await vscode.window.tabGroups.close(previous, true);
      }
    }),
    // Side preview that follows the active markdown text editor (for writing).
    vscode.commands.registerCommand("wikijsViewer.openToSide", async (uri?: vscode.Uri) => {
      const target = needMarkdown(uri);
      if (target) await preview.open(target);
    }),
    // From a Wiki.js Page: open the markdown source in a text editor beside it.
    vscode.commands.registerCommand("wikijsViewer.editSource", async (uri?: vscode.Uri) => {
      const target = needMarkdown(uri);
      if (target) await vscode.window.showTextDocument(target, { viewColumn: vscode.ViewColumn.Beside, preview: false });
    }),
    vscode.commands.registerCommand("wikijsViewer.refresh", (uri?: vscode.Uri) => {
      if (!refreshViews(services.views, uri instanceof vscode.Uri ? uri : undefined, activeMarkdownUri())) {
        void vscode.window.showInformationMessage("Open a Wiki.js Page or preview first.");
      }
    }),
    vscode.commands.registerCommand("wikijsViewer.showLog", () => output.show(true)),
    vscode.window.registerWebviewPanelSerializer(PREVIEW_VIEW_TYPE, {
      deserializeWebviewPanel: (panel, state: { uri?: string } | undefined) => preview.restore(panel, state),
    }),
  );
  services.log(`activated ${String(context.extension.packageJSON.version)}`);
  if (context.extensionMode !== vscode.ExtensionMode.Test) {
    void announceOnce(context);
    return undefined;
  }
  services.externalOpens = [];
  const viewOf = (kind: ViewKind): WikiView => {
    const views = [...services.views].filter((v) => v.kind === kind);
    const view = views.find((v) => v.panel.active) ?? views[views.length - 1];
    if (!view) throw new Error(`no open ${kind} view`);
    return view;
  };
  return {
    onDidPaint: services.onDidPaint,
    click: (kind, selector) => viewOf(kind).testRequest({ type: "test:click", selector }),
    state: (kind) => viewOf(kind).testRequest({ type: "test:state" }),
    probeMessages: (kind) => viewOf(kind).testRequest({ type: "test:probeMessages" }),
    locate: (kind, selector) => viewOf(kind).testRequest({ type: "test:locate", selector }),
    cover: (kind, selector) => viewOf(kind).testRequest({ type: "test:cover", selector }),
    query: (kind, selector, attr) => viewOf(kind).testRequest({ type: "test:query", selector, attr }),
    externalOpens: () => [...(services.externalOpens ?? [])],
  };
}

/** One notification per installed version, so the viewer is discoverable. */
async function announceOnce(context: vscode.ExtensionContext): Promise<void> {
  const version = String(context.extension.packageJSON.version ?? "");
  const key = "wikijsViewer.announcedVersion";
  if (context.globalState.get<string>(key) === version) return;
  await context.globalState.update(key, version);
  const choice = await vscode.window.showInformationMessage(
    `Wiki.js Page Viewer ${version}: pick "Wiki.js Page" in the editor switcher (next to Markdown Preview), use the blue book icon, or press Ctrl+Shift+V.`,
    "Open current page",
  );
  if (choice === "Open current page") await vscode.commands.executeCommand("wikijsViewer.open");
}

export function deactivate(): void {}
