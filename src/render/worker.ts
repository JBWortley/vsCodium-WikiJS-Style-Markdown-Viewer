/**
 * Render worker. markdown-it 11 and linkify-it 3 (pinned for fidelity with Wiki.js) have known
 * quadratic-time inputs; running them here lets the extension host enforce a timeout and kill a
 * runaway render without freezing VSCodium.
 */
import { parentPort } from "node:worker_threads";
import path from "node:path";
import { renderPage } from "./page";
import { makeAssetResolver } from "./assets";
import type { WorkerRequest, WorkerResponse } from "./protocol";

let pages = new Set<string>();

parentPort?.on("message", (msg: WorkerRequest) => {
  if (msg.type === "index") {
    pages = new Set(msg.pages);
    return;
  }
  let response: WorkerResponse;
  try {
    const localAssets = new Set<string>();
    const page = renderPage(msg.source, {
      siteUrl: msg.siteUrl,
      pagePath: msg.pagePath,
      pageExists: (p) => pages.has(p),
      resolveAsset: makeAssetResolver(msg.assets, path, file => localAssets.add(file)),
      markdown: msg.markdown,
    });
    page.localAssets = [...localAssets];
    response = { type: "rendered", id: msg.id, page };
  } catch (err) {
    response = { type: "error", id: msg.id, message: err instanceof Error ? err.message : String(err) };
  }
  parentPort?.postMessage(response);
});
