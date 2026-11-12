import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { RenderService } from "../src/preview/renderService";
import { WIKI_DEFAULTS } from "../src/render/markdown";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "wikijs-worker-test-"));
let renderer: RenderService;
beforeAll(async () => {
  await build({
    entryPoints: ["src/render/worker.ts"], outfile: path.join(temporary, "dist/renderWorker.js"), bundle: true, platform: "node", format: "cjs",
    alias: { cheerio: "./node_modules/cheerio/dist/esm/load-parse.js", punycode: "./node_modules/punycode/punycode.js" },
  });
  renderer = new RenderService(temporary, () => {});
});
afterAll(() => {
  renderer?.dispose();
  fs.rmSync(temporary, { recursive: true, force: true });
});

describe("worker asset refresh", () => {
  it("reports deduplicated local dependencies and keeps URLs stable until explicitly refreshed", async () => {
    const root = path.join(temporary, "wiki");
    const request = {
      source: "![One](/assets/drawing.svg#layer) ![Again](/assets/drawing.svg#layer) ![Remote](https://example.com/remote.svg)",
      pagePath: "home", siteUrl: "", markdown: WIKI_DEFAULTS,
      assets: { rootFsPath: root, rootUri: "https://res/wiki", docDirFsPath: root, cacheKey: "before" },
    };
    const first = await renderer.render(request);
    expect(first.localAssets).toEqual([path.join(root, "assets/drawing.svg")]);
    expect(first.contentHtml).toContain('src="https://res/wiki/assets/drawing.svg?__wikijs_preview=before#layer"');
    const typing = await renderer.render({ ...request, source: request.source + "\n\nNew text" });
    expect(typing.contentHtml).toContain('src="https://res/wiki/assets/drawing.svg?__wikijs_preview=before#layer"');
    expect(typing.contentHtml).toContain("New text");
    const refresh = await renderer.render({ ...request, assets: { ...request.assets, cacheKey: "after" } });
    expect(refresh.contentHtml).toContain('src="https://res/wiki/assets/drawing.svg?__wikijs_preview=after#layer"');
    expect(refresh.contentHtml).toContain('src="https://example.com/remote.svg"');
  });
});
