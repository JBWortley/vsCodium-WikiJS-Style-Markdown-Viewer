// Live test gate: runs test/live/suite.ts inside a real, separate VSCodium instance (throwaway
// profile, a synthetic demo wiki, a "*.md -> Markdown Preview" association) and drives
// it with real keystrokes and screenshots through scripts/win-driver.ps1.
//
//   node scripts/livetest.mjs --allow-desktop-control [--app vscodium|vscode] [--vault <demo-dir>] [--out <dir>]
//
// A VSCodium window appears and briefly takes keyboard focus for the keystroke steps.
import esbuild from "esbuild";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (!process.argv.includes("--allow-desktop-control")) {
  console.error("Live tests take control of the keyboard, mouse, clipboard and window focus. Obtain explicit consent for this run, then pass --allow-desktop-control.");
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const vault = path.resolve(arg("--vault", path.join(root, "test", "fixtures", "wiki")));
const out = path.resolve(arg("--out", path.join(os.tmpdir(), `wikijs-livetest-${Date.now()}`)));
// --app vscodium (default) or vscode; --assoc preview|default mirrors how .md opens on that install
// (VSCodium: built-in Markdown Preview; VS Code: no settings, so the text editor).
const app = arg("--app", "vscodium");
const EXES = {
  vscodium: "C:\\Program Files\\VSCodium\\VSCodium.exe",
  vscode: path.join(os.homedir(), "AppData", "Local", "Programs", "Microsoft VS Code", "Code.exe"),
};
if (!EXES[app]) throw new Error(`--app must be one of ${Object.keys(EXES).join(", ")}`);
const exe = (app === "vscodium" ? process.env.CODIUM_EXE : process.env.CODE_EXE) ?? EXES[app];
const assoc = arg("--assoc", app === "vscodium" ? "preview" : "default");
const TIMEOUT_MS = 6 * 60 * 1000;

const watched = ["home.md", "guide.md", "guide/revisions.md", "guide/writing.md", "guide/folders.md", "examples/embed.md"];
const digest = () => Object.fromEntries(watched.map((f) => [f, crypto.createHash("sha256").update(fs.readFileSync(path.join(vault, f))).digest("hex")]));

// 1. Build the extension and the in-VSCodium suite.
execFileSync(process.execPath, [path.join(root, "esbuild.config.mjs")], { cwd: root, stdio: "inherit" });
await esbuild.build({
  entryPoints: [path.join(root, "test", "live", "suite.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  outfile: path.join(root, "dist-test", "livetest.js"),
  logLevel: "warning",
});

// 2. Throwaway profile that mirrors the user's markdown setup.
const profile = path.join(out, "profile");
const extensionsDir = path.join(out, "extensions");
const shots = path.join(out, "shots");
for (const d of [path.join(profile, "User"), extensionsDir, shots]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(
  path.join(profile, "User", "settings.json"),
  JSON.stringify(
    {
      ...(assoc === "preview" ? { "workbench.editorAssociations": { "*.md": "vscode.markdown.preview.editor" } } : {}),
      "chat.disableAIFeatures": true,
      "workbench.secondarySideBar.defaultVisibility": "hidden",
      "workbench.welcomePage.walkthroughs.openOnInstall": false,
      "security.workspace.trust.enabled": false,
      "workbench.startupEditor": "none",
      "window.newWindowDimensions": "maximized",
      "window.restoreWindows": "none",
      "files.autoSave": "off",
      "files.hotExit": "off",
      "update.mode": "none",
      "extensions.autoCheckUpdates": false,
      "telemetry.telemetryLevel": "off",
      "workbench.tips.enabled": false,
    },
    null,
    2,
  ),
);

// 3. Launch a separate instance (own user-data-dir) with the extension under development.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(VSCODE_|ELECTRON_)/i.test(k)));
Object.assign(env, { WIKIJS_LIVETEST_DIR: out, WIKIJS_LIVETEST_VAULT: vault, WIKIJS_LIVETEST_ASSOC: assoc });
const before = digest();
const child = spawn(
  exe,
  [
    `--user-data-dir=${profile}`,
    `--extensions-dir=${extensionsDir}`,
    `--extensionDevelopmentPath=${root}`,
    `--extensionTestsPath=${path.join(root, "dist-test", "livetest.js")}`,
    "--new-window",
    "--skip-welcome",
    "--skip-release-notes",
    "--disable-workspace-trust",
    vault,
  ],
  { env, stdio: "ignore", windowsHide: false },
);
console.log(`${app} live test started (pid ${child.pid}, .md opens in: ${assoc}); results in ${out}`);

// 4. Serve driver requests from the suite until VSCodium exits.
const driver = path.join(root, "scripts", "win-driver.ps1");
let exited = null;
child.on("exit", (code) => (exited = code ?? 1));
const started = Date.now();
let n = 1;
while (exited === null && Date.now() - started < TIMEOUT_MS) {
  const req = path.join(out, `req-${n}.json`);
  if (!fs.existsSync(req)) {
    await new Promise((r) => setTimeout(r, 150));
    continue;
  }
  const request = JSON.parse(fs.readFileSync(req, "utf8"));
  const psArgs = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", driver, "-ProcessRoot", String(child.pid)];
  if (request.action === "screenshot") psArgs.push("-Action", "screenshot", "-Out", path.join(shots, `${request.name}.png`));
  else if (request.action === "alttap") psArgs.push("-Action", "alttap");
  else if (request.action === "move") psArgs.push("-Action", "move", "-FX", String(request.fx), "-FY", String(request.fy));
  else if (request.action === "click" && request.x !== undefined) psArgs.push("-Action", "click", "-X", String(request.x), "-Y", String(request.y));
  else if (request.action === "click") psArgs.push("-Action", "click", "-FX", String(request.fx), "-FY", String(request.fy));
  else if (request.action === "rect") psArgs.push("-Action", "rect");
  else psArgs.push("-Action", "keys", "-Keys", request.keys);
  const r = spawnSync("powershell", psArgs, { encoding: "utf8" });
  const ok = r.status === 0;
  const info = (r.stdout || "").trim();
  const error = (r.stderr || "").trim().split("\n").slice(0, 3).join(" ");
  console.log(`  driver #${n} ${request.action} ${request.name ?? request.keys ?? ""}: ${ok ? info : `FAILED ${error}`}`);
  fs.writeFileSync(path.join(out, `ack-${n}.json`), JSON.stringify({ ok, info, error }));
  n++;
}
if (exited === null) {
  console.error("Timed out; stopping VSCodium test instance.");
  spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
}

// 5. Report.
const resultsFile = path.join(out, "results.json");
const results = fs.existsSync(resultsFile) ? JSON.parse(fs.readFileSync(resultsFile, "utf8")) : [];
console.log("\nLive test results");
for (const r of results) {
  const status = r.skipped ? "SKIP" : r.ok ? "PASS" : "FAIL";
  const retry = r.shortcutRetries ? `\n        note: input retried (${r.shortcutRetries.join("; ")}): the first attempt never reached the editor` : "";
  const extra = (r.skipped ? `\n        ${r.detail}` : r.ok ? "" : `\n        ${String(r.error).split("\n")[0]}`) + retry;
  console.log(`  ${status}  ${r.name}  (${r.ms} ms)${extra}`);
}
const after = digest();
const changed = watched.filter((f) => before[f] !== after[f]);
console.log(`  ${changed.length ? "FAIL" : "PASS"}  vault files unchanged (checked outside the editor)${changed.length ? `: ${changed.join(", ")}` : ""}`);
console.log(`\nScreenshots: ${shots}`);
const passed = results.length > 0 && results.every((r) => r.ok) && !changed.length && exited === 0;
console.log(passed ? `LIVE GATE (${app}): PASSED` : `LIVE GATE (${app}): FAILED (editor exit ${exited})`);
process.exit(passed ? 0 : 1);
