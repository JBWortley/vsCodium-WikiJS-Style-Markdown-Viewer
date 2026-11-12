import * as vscode from "vscode";
import path from "node:path";

function key(file: string): string {
  const normalized = path.resolve(file);
  return process.platform === "win32" || process.platform === "darwin" ? normalized.toLowerCase() : normalized;
}

/** Watch a wiki root only while the view uses local assets, filtering to those dependencies.
 * Watching the root also catches newly created or replaced asset directories.
 */
export class AssetWatcher implements vscode.Disposable {
  private root?: string;
  private files = new Set<string>();
  private watcher?: vscode.FileSystemWatcher;

  constructor(private readonly changed: () => void) {}

  update(root: string | undefined, files: readonly string[]): void {
    this.files = new Set(files.map(key));
    const nextRoot = root && this.files.size ? key(root) : undefined;
    if (nextRoot === this.root) return;
    this.watcher?.dispose();
    this.watcher = undefined;
    this.root = nextRoot;
    if (!nextRoot) return;
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(root!), "**/*"));
    watcher.onDidChange(uri => this.onChange(uri));
    watcher.onDidCreate(uri => this.onChange(uri));
    watcher.onDidDelete(uri => this.onChange(uri));
    this.watcher = watcher;
  }

  private onChange(uri: vscode.Uri): void {
    const changed = key(uri.fsPath);
    if (this.files.has(changed) || [...this.files].some(file => file.startsWith(changed + path.sep))) this.changed();
  }

  dispose(): void {
    this.watcher?.dispose();
    this.watcher = undefined;
    this.root = undefined;
    this.files.clear();
  }
}
