import type { MarkdownOptions } from "./markdown";
import type { RenderedPage } from "./page";
import type { EditRequest } from "../editing/edits";

export interface AssetBases {
  rootFsPath: string;
  /** `webview.asWebviewUri(root)` without a trailing slash. */
  rootUri: string;
  docDirFsPath: string;
  /** Stable during Markdown edits; changed when local assets must be fetched again. */
  cacheKey?: string;
}

/** Extension host -> render worker. */
export type WorkerRequest =
  | { type: "index"; pages: string[] }
  | {
      type: "render";
      id: number;
      source: string;
      pagePath: string;
      siteUrl: string;
      markdown: MarkdownOptions;
      assets: AssetBases;
      editKey?: string;
    };

/** Render worker -> extension host. */
export type WorkerResponse = { type: "rendered"; id: number; page: RenderedPage } | { type: "error"; id: number; message: string };

/** Extension host -> webview. */
export type ToWebview =
  | { type: "render"; uri: string; page: RenderedPage }
  | { type: "renderError"; message: string }
  | { type: "editResult"; id: string; ok: boolean; message?: string }
  | { type: "scrollToLine"; line: number }
  | { type: "scrollToAnchor"; id: string }
  /** Live-test hooks: the extension only sends these in ExtensionMode.Test. */
  | { type: "test:click"; selector: string; shiftKey?: boolean; double?: boolean }
  | { type: "test:input"; selector: string; text: string }
  | { type: "test:state" }
  | { type: "test:probeMessages" }
  /** Scroll an element into view and report where it is (for a real mouse click). */
  | { type: "test:locate"; selector: string }
  /** Make an element cover the whole page, so a real OS click anywhere in the page hits it. */
  | { type: "test:cover"; selector: string }
  | { type: "test:query"; selector: string; attr?: string };

/** Webview -> extension host. */
export type FromWebview =
  | { type: "ready" }
  | { type: "refresh" }
  | ({ type: "edit" } & EditRequest)
  | { type: "link"; href: string }
  /** What the webview actually painted, for the log and the end-to-end test. */
  | { type: "painted"; uri: string; blocks: number; height: number; background: string; calloutBackground?: string; overflowX: number }
  /** Code-block Copy: the host writes the clipboard (webview clipboard needs focus/permission). */
  | { type: "copy"; text: string }
  | {
      type: "test:state";
      scrollY: number;
      clicked?: boolean;
      untrustedMessagesIgnored?: boolean;
      title: string;
      log?: string[];
      /** test:locate: element rect in viewport CSS px, plus the screen offset learned from mouse moves. */
      rect?: { x: number; y: number; width: number; height: number };
      calib?: { dx: number; dy: number; dpr: number; clientX: number; clientY: number; trusted: boolean };
      /** test:query: matches and the first match's attribute value. */
      count?: number;
      attr?: string | null;
      value?: string;
      text?: string;
      /** Loaded image dimensions, so live checks verify the bytes fetched, not only the URL. */
      image?: { complete: boolean; width: number; height: number };
      pwned?: string;
      /** document.hasFocus(): a modal workbench dialog (e.g. VSCodium's own link prompt) takes it away. */
      focused?: boolean;
      /** Live-test diagnostics: element under the locate point, and recent real pointer events. */
      hit?: string;
      lastPointer?: string[];
    };
