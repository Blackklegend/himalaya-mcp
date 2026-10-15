import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { HimalayaClient } from "../src/himalaya/client.js";
import { downloadAndList, registerAttachmentTools } from "../src/tools/attachments.js";

const cleanup: string[] = [];
afterEach(() => { for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true }); vi.restoreAllMocks(); });

function syntheticClient(populate: (directory: string) => void) {
  const client = new HimalayaClient();
  vi.spyOn(client, "downloadAttachments").mockImplementation(async (_id, directory) => {
    cleanup.push(directory);
    populate(directory);
    return "{}";
  });
  return client;
}

describe("inbound attachment filesystem boundary", () => {
  it("uses a private temporary directory and lists regular parts", async () => {
    const client = syntheticClient(directory => writeFileSync(join(directory, "report.pdf"), "fixture pdf"));
    const result = await downloadAndList(client, "1");
    expect(statSync(result.destDir).mode & 0o777).toBe(0o700);
    expect(result.files.map(file => file.filename)).toEqual(["report.pdf"]);
  });
  it("rejects symlinks including body-part names and cleans all temporary output", async () => {
    const outside = mkdtempSync(join(tmpdir(), "himalaya-outside-test-")); cleanup.push(outside);
    const secret = join(outside, "secret"); writeFileSync(secret, "secret fixture");
    let output = "";
    const client = syntheticClient(directory => { output = directory; symlinkSync(secret, join(directory, "plain.txt")); });
    await expect(downloadAndList(client, "1")).rejects.toThrow("Unsafe downloaded part");
    expect(existsSync(output)).toBe(false);
    expect(readFileSync(secret, "utf8")).toBe("secret fixture");
  });
  it("cleans partial output when the CLI fails", async () => {
    let output = "";
    const client = syntheticClient(directory => { output = directory; writeFileSync(join(directory, "partial.pdf"), "partial"); throw new Error("synthetic failure"); });
    await expect(downloadAndList(client, "1")).rejects.toThrow("synthetic failure");
    expect(existsSync(output)).toBe(false);
  });
  it("retains a successful requested download so its returned path works", async () => {
    const client = syntheticClient(directory => writeFileSync(join(directory, "report.pdf"), "usable fixture"));
    const server = new McpServer({ name: "test", version: "0" });
    registerAttachmentTools(server, client);
    const result = await (server as any)._registeredTools.download_attachment.handler({ id: "1", filename: "report.pdf" }, {});
    expect(result.isError).toBeUndefined();
    expect(readFileSync(join(cleanup[0], "report.pdf"), "utf8")).toBe("usable fixture");
    expect(result.content[0].text).toContain(join(cleanup[0], "report.pdf"));
  });
  it("listing cleans its download directory", async () => {
    const client = syntheticClient(directory => writeFileSync(join(directory, "report.pdf"), "fixture"));
    const server = new McpServer({ name: "test", version: "0" });
    registerAttachmentTools(server, client);
    const result = await (server as any)._registeredTools.list_attachments.handler({ id: "1" }, {});
    expect(result.isError).toBeUndefined();
    expect(existsSync(cleanup[0])).toBe(false);
  });
});
