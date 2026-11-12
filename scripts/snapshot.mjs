// Bundles scripts/snapshotEntry.ts on the fly and runs it with the remaining arguments.
import esbuild from "esbuild";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wikijs-snapshot-"));
const outfile = path.join(tmp, "snapshot.cjs");
await esbuild.build({
  entryPoints: [path.join(here, "snapshotEntry.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile,
  logLevel: "warning",
  define: { __dirname: JSON.stringify(here) },
});
const result = spawnSync(process.execPath, [outfile, ...process.argv.slice(2)], { stdio: "inherit" });
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(result.status ?? 1);
