import { describe, expect, it, vi } from "vitest";
import { refreshViews } from "../src/preview/refresh";

const resource = (url: string) => ({ scheme: url.split(":")[0], toString: () => url });
const view = (kind: "editor" | "preview", file: string, active = false) => ({
  kind, doc: { uri: resource(file) }, panel: { active }, refresh: vi.fn(),
});

describe("refresh command targeting", () => {
  it("refreshes the side panel when its title button passes a webview-panel URI, including from an inactive group", () => {
    const editor = view("editor", "file:///wiki/other.md", true);
    const preview = view("preview", "file:///wiki/home.md");
    expect(refreshViews([editor, preview], resource("webview-panel:/webview-panel/generated-id"))).toBe(true);
    expect(preview.refresh).toHaveBeenCalledTimes(1);
    expect(editor.refresh).not.toHaveBeenCalled();
  });
  it("honors an inactive custom editor's explicit resource and refreshes both views of that document", () => {
    const editor = view("editor", "file:///wiki/home.md");
    const preview = view("preview", "file:///wiki/home.md");
    const other = view("editor", "file:///wiki/other.md", true);
    expect(refreshViews([editor, preview, other], resource("file:///wiki/home.md"))).toBe(true);
    expect(editor.refresh).toHaveBeenCalledTimes(1);
    expect(preview.refresh).toHaveBeenCalledTimes(1);
    expect(other.refresh).not.toHaveBeenCalled();
  });
  it("prefers the active Wiki.js view to a stale source editor and falls back to the source when none is active", () => {
    const preview = view("preview", "file:///wiki/home.md", true);
    const other = view("editor", "file:///wiki/other.md");
    expect(refreshViews([preview, other], undefined, other.doc.uri)).toBe(true);
    expect(preview.refresh).toHaveBeenCalledTimes(1);
    expect(other.refresh).not.toHaveBeenCalled();
    preview.panel.active = false;
    expect(refreshViews([preview, other], undefined, other.doc.uri)).toBe(true);
    expect(other.refresh).toHaveBeenCalledTimes(1);
  });
  it("reports no matching view without refreshing another document", () => {
    const preview = view("preview", "file:///wiki/home.md");
    expect(refreshViews([preview], resource("file:///wiki/missing.md"))).toBe(false);
    expect(refreshViews([preview])).toBe(false);
    expect(preview.refresh).not.toHaveBeenCalled();
  });
});
