import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

describe("standalone snapshots", () => {
  it("classifies links using an explicitly supplied wiki URL", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wikijs-tooling-test-"));
    try {
      const vault = path.join(tmp, "vault");
      const out = path.join(tmp, "output");
      fs.mkdirSync(vault);
      fs.writeFileSync(path.join(vault, "home.md"), "[Guide](https://wiki.example.test/guide)\n");
      fs.writeFileSync(path.join(vault, "guide.md"), "# Guide\n");
      const result = spawnSync(process.execPath, ["scripts/snapshot.mjs", "--vault", vault, "--out", out, "--site-url", "https://wiki.example.test", "home"], {
        cwd: path.resolve(__dirname, ".."), encoding: "utf8", windowsHide: true,
      });
      expect(result.status, result.stderr).toBe(0);
      const html = fs.readFileSync(path.join(out, "home.html"), "utf8");
      expect(html).toContain('href="/guide" class="is-internal-link is-valid-page"');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 15000);
});
