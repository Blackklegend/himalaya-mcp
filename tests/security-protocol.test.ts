/** Actual MCP transport tests, with a synthetic CLI and no mailbox connection. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CAPABILITIES, permittedTools } from "../src/security.js";

const execFileAsync = promisify(execFile);
const root = resolve(__dirname, "..");
let directory: string, binary: string, log: string;
beforeAll(async () => {
  await execFileAsync("npm", ["run", "build"], { cwd: root });
  directory = mkdtempSync(join(tmpdir(), "himalaya-protocol-security-"));
  binary = join(directory, "fake-himalaya");
  log = join(directory, "commands.jsonl");
  writeFileSync(binary, `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + "\\n");
if (args[0] === "--version") console.log("himalaya 1.1.0");
else if (args[0] === "template" && args[1] === "send") { console.error("TEST DELIVERY MUST NEVER BE REACHED"); process.exitCode = 99; }
else if (args[0] === "message" && args[1] === "read" && args.includes("--preview")) console.log(JSON.stringify("synthetic mailbox body"));
else if (args[0] === "envelope") console.log("[]");
else { console.error("unexpected synthetic command"); process.exitCode = 98; }
`, { mode: 0o700 });
});
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

async function connect(capabilities: string) {
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  Object.assign(env, { HIMALAYA_BINARY: binary, HIMALAYA_FROM: "fixture@example.com", HIMALAYA_CAPABILITIES: capabilities });
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(root, "dist/index.js")], env });
  const client = new Client({ name: "security-test", version: "1" });
  await client.connect(transport);
  return client;
}

describe("security boundaries over stdio", () => {
  it("exposes only the default read set and refuses hidden tools by name", async () => {
    const client = await connect("");
    try {
      expect((await client.listTools()).tools.map(t => t.name).sort()).toEqual(permittedTools(new Set()).sort());
      for (const name of ["send_email", "compose_email", "flag_email", "move_email", "copy_to_clipboard", "download_attachment", "create_calendar_event", "snooze_email"]) {
        const denied = await client.callTool({ name, arguments: { confirm: true, id: "1", template: "To: x@y.com\nSubject: X\n\nBody" } });
        expect(denied.isError).toBe(true);
        expect(JSON.stringify(denied.content)).toContain("not found");
      }
      const read = await client.callTool({ name: "read_email", arguments: { id: "1" } });
      expect(read.isError).not.toBe(true);
      expect(JSON.stringify(read.content)).toContain("synthetic mailbox body");
    } finally { await client.close(); }
  });

  it("every opt-in still rejects first-call and post-preview delivery attempts", async () => {
    const client = await connect(CAPABILITIES.join(","));
    try {
      const template = "From: fixture@example.com\nTo: alice@example.com\nSubject: Test\n\nBody";
      for (const name of ["send_email", "compose_email"]) {
        const args = name === "send_email" ? { template } : { to: "alice@example.com", subject: "Test", body: "Body" };
        const initial = await client.callTool({ name, arguments: { ...args, confirm: true } });
        expect(initial.isError).toBe(true);
        expect(JSON.stringify(initial.content)).toContain("Delivery disabled");
        const preview = await client.callTool({ name, arguments: args });
        expect(preview.isError).not.toBe(true);
        expect(JSON.stringify(preview.content)).toContain("PREVIEW");
        const repeat = await client.callTool({ name, arguments: { ...args, confirm: true } });
        expect(repeat.isError).toBe(true);
      }
    } finally { await client.close(); }
    const commands = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line)) : [];
    expect(commands.some(args => args[0] === "template" && args[1] === "send")).toBe(false);
    expect(commands.some(args => args[0] === "message" && args[1] === "send")).toBe(false);
  });

  it("prints manual configuration pinned to this build without activating it", async () => {
    const { stdout } = await execFileAsync(process.execPath, [join(root, "dist/cli/index.js"), "config"], { cwd: root });
    const config = JSON.parse(stdout).mcpServers.himalaya;
    expect(config.command).toBe(process.execPath);
    expect(config.args).toEqual([realpathSync(join(root, "dist/index.js"))]);
    expect(config.env.HIMALAYA_CAPABILITIES).toBe("");
    expect(stdout).not.toContain("/opt/himalaya-mcp/");
    expect(stdout).not.toContain("marketplace");
  });
});
