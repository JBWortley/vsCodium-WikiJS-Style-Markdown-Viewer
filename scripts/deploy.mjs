// Packages the extension and installs it into VSCodium and/or Microsoft VS Code.
//   npm run deploy                                check + package + install into VSCodium
//   npm run deploy -- --to vscodium,vscode        ... into both
//   npm run deploy -- --launch <dir>              ... then open <dir> in the first target
// Run `npm run livetest -- --app <target>` for every target first: that is the release gate.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vsix = path.join(root, "dist", "wikijs-page-viewer.vsix");
const CLIS = {
  vscodium: process.env.CODIUM_CLI ?? "C:\\Program Files\\VSCodium\\bin\\codium.cmd",
  vscode: process.env.CODE_CLI ?? path.join(os.homedir(), "AppData", "Local", "Programs", "Microsoft VS Code", "bin", "code.cmd"),
};
const NAMES = { vscodium: "VSCodium", vscode: "VS Code" };
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const targets = (opt("--to") ?? "vscodium").split(",").map((t) => t.trim());
const launchTarget = opt("--launch");

function run(command, commandArgs, options = {}) {
  console.log(`> ${command} ${commandArgs.join(" ")}`);
  // .cmd shims need a shell on Windows; arguments are quoted to survive paths with spaces.
  const quoted = commandArgs.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a));
  const result = spawnSync(/[\s]/.test(command) ? `"${command}"` : command, quoted, { cwd: root, stdio: "inherit", shell: true, ...options });
  if (result.status !== 0) {
    console.error(`failed: ${command} (exit ${result.status})`);
    process.exit(result.status ?? 1);
  }
}

for (const t of targets) {
  if (!CLIS[t]) {
    console.error(`Unknown target "${t}". Use: ${Object.keys(CLIS).join(", ")}`);
    process.exit(1);
  }
  if (!fs.existsSync(CLIS[t])) {
    console.error(`${NAMES[t]} CLI not found at ${CLIS[t]}.`);
    process.exit(1);
  }
}

run("npm", ["run", "package"]);
for (const t of targets) {
  run(CLIS[t], ["--install-extension", vsix, "--force"]);
  console.log(`Installed into ${NAMES[t]}. Close all ${NAMES[t]} windows and start it again to load the new version.`);
}

if (launchTarget) {
  if (!fs.existsSync(launchTarget)) {
    console.error(`--launch target not found: ${launchTarget}`);
    process.exit(1);
  }
  const spawnArgs = [launchTarget];
  const home = path.join(launchTarget, "home.md");
  if (fs.existsSync(home)) spawnArgs.push(home);
  run(CLIS[targets[0]], spawnArgs);
}
