import fs from "node:fs";
import path from "node:path";
import { pagePathFromRelativeFile } from "../../src/render/paths";

/** Test-side page index (the extension builds the same keys with workspace.findFiles). */
export function buildPageIndex(root: string): Set<string> {
  const pages = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.toLowerCase().endsWith(".md")) pages.add(pagePathFromRelativeFile(path.relative(root, full)));
    }
  };
  walk(root);
  return pages;
}
