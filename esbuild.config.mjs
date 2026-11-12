import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";

const watch = process.argv.includes("--watch");

/** Extension host + render worker run in Node; the preview script runs in the webview. */
const builds = [
  {
    entryPoints: { extension: "src/extension.ts", renderWorker: "src/render/worker.ts" },
    outdir: "dist",
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["vscode"],
    alias: {
      // cheerio's index adds fromURL()/stream helpers that pull in undici and encoding sniffers
      // (~1.6 MB) the renderer never uses; its parse5 `load` lives in load-parse.js.
      cheerio: "./node_modules/cheerio/dist/esm/load-parse.js",
      // markdown-it 11 requires Node's deprecated `punycode` builtin; use the userland copy.
      punycode: "./node_modules/punycode/punycode.js",
    },
  },
  {
    entryPoints: { preview: "src/webview/preview.ts" },
    outdir: "dist",
    platform: "browser",
    format: "iife",
    target: "chrome120",
  },
];

/** Packages that end up inside the bundles, from esbuild's metafile inputs. */
function bundledPackages(metafile) {
  const dirs = new Set();
  for (const input of Object.keys(metafile.inputs)) {
    const m = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(input.replace(/\\/g, "/"));
    if (m) dirs.add(m[1]);
  }
  return [...dirs].sort();
}

/** Writes dist/THIRD-PARTY-NOTICES.txt with each bundled package's own license text. */
function writeNotices(packageDirs) {
  const parts = [];
  for (const dir of packageDirs) {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    const licenseFile = fs.readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
    const text = licenseFile ? fs.readFileSync(path.join(dir, licenseFile), "utf8").trim() : `License: ${pkg.license ?? "unknown"} (no license file shipped)`;
    parts.push(`${"=".repeat(78)}\n${pkg.name}@${pkg.version} (${pkg.license ?? "unknown"})\n${"=".repeat(78)}\n${text}\n`);
  }
  fs.writeFileSync("dist/THIRD-PARTY-NOTICES.txt", `Third-party software bundled in the Wiki.js Page Viewer\n\n${parts.join("\n")}`);
  console.log(`  dist/THIRD-PARTY-NOTICES.txt (${packageDirs.length} packages)`);
}

const packages = new Set();
for (const options of builds) {
  const ctx = await esbuild.context({
    bundle: true,
    sourcemap: watch ? "inline" : false,
    minify: !watch,
    legalComments: "linked",
    logLevel: "info",
    metafile: true,
    ...options,
  });
  if (watch) await ctx.watch();
  else {
    const result = await ctx.rebuild();
    for (const dir of bundledPackages(result.metafile)) packages.add(dir);
    await ctx.dispose();
  }
}
if (!watch) writeNotices([...packages]);
