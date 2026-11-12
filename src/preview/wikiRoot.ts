import fs from "node:fs";
import path from "node:path";
import { pagePathFromRelativeFile } from "../render/paths";

/**
 * Wiki root for a page: the configured override, else the nearest ancestor of the page that
 * contains `home.md` (searching above the workspace folder too, so opening a vault subfolder
 * still finds the vault), else the workspace folder, else the page's own folder.
 */
export function findWikiRoot(docFsPath: string, override: string, workspaceFolder: string | undefined): string {
  if (override.trim()) return path.resolve(override.trim());
  let dir = path.dirname(docFsPath);
  for (;;) {
    if (fs.existsSync(path.join(dir, "home.md"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return workspaceFolder ? path.resolve(workspaceFolder) : path.dirname(docFsPath);
}

/** Wiki page path of a file under `root` (`home` for `<root>/home.md`). */
export function pagePathFor(docFsPath: string, root: string): string {
  const relative = path.relative(root, docFsPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return pagePathFromRelativeFile(path.basename(docFsPath));
  return pagePathFromRelativeFile(relative);
}

/** Every `*.md` under root as a page key; skips dot-folders (.git, .obsidian) and node_modules. */
export async function scanPages(root: string): Promise<string[]> {
  const pages: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(
      entries.map(async (entry) => {
        if (entry.name.startsWith(".") || entry.name === "node_modules") return;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) pages.push(pagePathFromRelativeFile(path.relative(root, full)));
      }),
    );
  };
  await walk(root);
  return pages.sort();
}

/** Locates the markdown file for a page key, case-insensitively like Wiki.js paths. */
export function fileForPage(root: string, pagePath: string): string | undefined {
  if (!pagePath || pagePath.split("/").some((s) => s === ".." || s === ".")) return undefined;
  const direct = path.join(root, ...pagePath.split("/")) + ".md";
  if (fs.existsSync(direct)) return direct;
  // Case-insensitive walk for case-sensitive file systems.
  let dir = root;
  const segments = pagePath.split("/");
  for (let i = 0; i < segments.length; i++) {
    const want = i === segments.length - 1 ? `${segments[i]}.md` : segments[i];
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return undefined;
    }
    const hit = names.find((n) => n.toLowerCase() === want.toLowerCase());
    if (!hit) return undefined;
    dir = path.join(dir, hit);
  }
  return dir;
}
