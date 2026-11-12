import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { AssetWatcher } from "../src/preview/assetWatcher";

const boundary = vi.hoisted(() => {
  type Listener = (uri: { fsPath: string }) => void;
  class Watcher {
    disposed = false;
    change?: Listener;
    create?: Listener;
    delete?: Listener;
    constructor(readonly directory: string) {}
    onDidChange(fn: Listener) { this.change = fn; return { dispose() {} }; }
    onDidCreate(fn: Listener) { this.create = fn; return { dispose() {} }; }
    onDidDelete(fn: Listener) { this.delete = fn; return { dispose() {} }; }
    dispose() { this.disposed = true; }
    emit(type: "create" | "change" | "delete", file: string) {
      if (!this.disposed) this[type]?.({ fsPath: file });
    }
  }
  return { Watcher, watchers: [] as Watcher[] };
});

// Only the editor's external file-event boundary is replaced. Filtering and watcher ownership
// run in the real AssetWatcher; the live suite checks actual operating-system file events.
vi.mock("vscode", () => ({
  Uri: { file: (fsPath: string) => ({ fsPath }) },
  RelativePattern: class { constructor(readonly baseUri: { fsPath: string }, readonly pattern: string) {} },
  workspace: {
    createFileSystemWatcher: (pattern: { baseUri: { fsPath: string } }) => {
      const watcher = new boundary.Watcher(pattern.baseUri.fsPath);
      boundary.watchers.push(watcher);
      return watcher;
    },
  },
}));

beforeEach(() => { boundary.watchers.length = 0; });
const root = path.resolve("demo-wiki");
const file = (name: string) => path.join(root, name);

describe("local asset watching", () => {
  it("invalidates referenced assets for saves, atomic replacements and missing-file creation, ignoring other files", () => {
    const invalidated: number[] = [];
    const tracker = new AssetWatcher(() => invalidated.push(1));
    tracker.update(root, [file("assets/drawing.svg"), file("assets/missing.png")]);
    expect(boundary.watchers).toHaveLength(1);
    const watcher = boundary.watchers[0];
    watcher.emit("change", file("assets/unrelated.svg"));
    expect(invalidated).toHaveLength(0);
    watcher.emit("change", file("assets/drawing.svg"));
    watcher.emit("delete", file("assets/drawing.svg"));
    watcher.emit("create", file("assets/drawing.svg"));
    watcher.emit("create", file("assets/missing.png"));
    expect(invalidated).toHaveLength(4);
    tracker.dispose();
  });

  it("replaces dependencies on navigation, reuses a root watch, and stops after disposal", () => {
    const invalidated: number[] = [];
    const tracker = new AssetWatcher(() => invalidated.push(1));
    tracker.update(root, [file("assets/old.svg"), file("other/old.svg")]);
    const [shared] = boundary.watchers;
    tracker.update(root, [file("assets/new.svg")]);
    expect(boundary.watchers).toHaveLength(1);
    shared.emit("change", file("assets/old.svg"));
    shared.emit("change", file("other/old.svg"));
    expect(invalidated).toHaveLength(0);
    shared.emit("change", file("assets/new.svg"));
    expect(invalidated).toHaveLength(1);
    tracker.dispose();
    shared.emit("change", file("assets/new.svg"));
    expect(invalidated).toHaveLength(1);
    expect(shared.disposed).toBe(true);
  });

  it("releases all watches when a page no longer has local assets", () => {
    const tracker = new AssetWatcher(() => {});
    tracker.update(root, [file("assets/a.svg")]);
    tracker.update(root, []);
    expect(boundary.watchers[0].disposed).toBe(true);
    tracker.dispose();
  });

  it("handles parent directory replacement and disposes the previous root on a root change", () => {
    const changed = vi.fn();
    const tracker = new AssetWatcher(changed);
    tracker.update(root, [file("assets/new/drawing.svg")]);
    const [old] = boundary.watchers;
    old.emit("create", file("assets/new"));
    old.emit("delete", file("assets"));
    expect(changed).toHaveBeenCalledTimes(2);
    const other = path.resolve("other-wiki");
    tracker.update(other, [path.join(other, "a.svg")]);
    expect(old.disposed).toBe(true);
    old.emit("change", file("assets/new/drawing.svg"));
    expect(changed).toHaveBeenCalledTimes(2);
    boundary.watchers[1].emit("change", path.join(other, "a.svg"));
    expect(changed).toHaveBeenCalledTimes(3);
    tracker.dispose();
  });
});
