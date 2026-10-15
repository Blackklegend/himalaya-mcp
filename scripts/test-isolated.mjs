// Run the suite with a disposable home and fake external commands.
// No mailbox credentials/configuration or desktop activation is needed.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const home = mkdtempSync(join(tmpdir(), "himalaya-tests-home-"));
const bin = join(home, "bin"); mkdirSync(bin);
const fixture = join(root, "tests/fixtures/fake-himalaya/index.mjs");
// Paths are encoded as JS literals, never interpolated into a shell command.
writeFileSync(join(bin, "himalaya"), `#!${process.execPath}\nimport ${JSON.stringify(fixture)};\n`, { mode: 0o700 });
for (const name of ["osascript", "pbcopy", "xclip", "claude"]) {
  writeFileSync(join(bin, name), '#!/bin/sh\necho "Unmocked desktop operation blocked by test harness" >&2\nexit 99\n', { mode: 0o700 });
}
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith("HIMALAYA_")) delete env[key];
Object.assign(env, { HOME: home, XDG_CONFIG_HOME: join(home, "config"), HIMALAYA_CONFIG: join(home, "empty-config.toml"), PATH: `${bin}:${env.PATH}`, npm_config_cache: join(home, "npm-cache") });
const child = spawn(process.execPath, [join(root, "node_modules/vitest/vitest.mjs"), "run", ...process.argv.slice(2)], { cwd: root, env, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", err => { console.error(err.message); rmSync(home, { recursive: true, force: true }); process.exitCode = 1; });
child.on("exit", (code, signal) => { rmSync(home, { recursive: true, force: true }); process.exitCode = code ?? (signal ? 1 : 0); });
