import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeAssetResolver } from "../src/render/assets";
import { fileForPage, findWikiRoot, pagePathFor, scanPages } from "../src/preview/wikiRoot";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wikijs-viewer-test-"));
const wiki = path.join(tmp, "Wiki Root");
const write = (rel: string, text = "x") => {
  const file = path.join(wiki, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
};
const home = write("home.md");
const page = write("About-Drafting/Good Drawing.md");
write("about-drafting.md");
write(".obsidian/ignored.md");
write("node_modules/pkg/readme.md");
write("assets/a b.png");

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("asset resolver", () => {
  const resolve = makeAssetResolver({ rootFsPath: wiki, rootUri: "https://res/wiki", docDirFsPath: path.dirname(page) });
  it("resolves wiki-root and page-relative paths with per-segment encoding", () => {
    expect(resolve("/assets/a%20b.png")).toBe("https://res/wiki/assets/a%20b.png");
    expect(resolve("/assets/a b.png?v=2#x")).toBe("https://res/wiki/assets/a%20b.png");
    expect(resolve("img/x.png")).toBe("https://res/wiki/About-Drafting/img/x.png");
  });
  it("refuses anything outside the wiki root or with a scheme", () => {
    expect(resolve("../../outside.png")).toBeUndefined();
    expect(resolve("/../../outside.png")).toBeUndefined();
    expect(resolve("https://example.com/x.png")).toBeUndefined();
    expect(resolve("data:image/png;base64,AA")).toBeUndefined();
    expect(resolve("//cdn.example.com/x.png")).toBeUndefined();
  });
});

describe("wiki root", () => {
  it("finds the nearest folder with home.md, honouring the override", () => {
    expect(findWikiRoot(page, "", tmp)).toBe(wiki);
    expect(findWikiRoot(home, "", undefined)).toBe(wiki);
    expect(findWikiRoot(page, tmp, undefined)).toBe(path.resolve(tmp));
  });
  it("falls back to the workspace folder when no home.md exists", () => {
    const loose = path.join(tmp, "loose", "deep", "p.md");
    fs.mkdirSync(path.dirname(loose), { recursive: true });
    fs.writeFileSync(loose, "x");
    expect(findWikiRoot(loose, "", path.join(tmp, "loose"))).toBe(path.join(tmp, "loose"));
  });
  it("keeps page-key case (Wiki.js paths are case-sensitive) and finds files case-insensitively", async () => {
    expect(pagePathFor(page, wiki)).toBe("About-Drafting/Good Drawing");
    expect(pagePathFor(home, wiki)).toBe("home");
    expect(fileForPage(wiki, "about-drafting/good drawing")?.toLowerCase()).toBe(page.toLowerCase());
    expect(fileForPage(wiki, "missing/page")).toBeUndefined();
    expect(await scanPages(wiki)).toEqual(["About-Drafting/Good Drawing", "about-drafting", "home"]);
  });
});
