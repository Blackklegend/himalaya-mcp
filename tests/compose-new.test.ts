import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { HimalayaClient } from "../src/himalaya/client.js";
import { registerComposeNewTools } from "../src/tools/compose-new.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let client: HimalayaClient, handler: Function, dir: string;
const args = { to: "alice@example.com", subject: "Hi", body: "Hello" };
beforeEach(() => {
  const server = new McpServer({ name: "test", version: "0" });
  client = new HimalayaClient({ from: "me@example.com" });
  vi.spyOn(client, "sendTemplate").mockResolvedValue("{}");
  registerComposeNewTools(server, client);
  handler = (server as any)._registeredTools.compose_email.handler;
  dir = mkdtempSync(join(tmpdir(), "himalaya-compose-test-"));
  vi.stubEnv("HIMALAYA_CAPABILITIES", "drafts,attachments");
  vi.stubEnv("HIMALAYA_ATTACHMENT_ROOT", dir);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });

describe("compose_email previews", () => {
  it("previews every recipient including Bcc, subject, sender and complete body", async () => {
    const result = await handler({ ...args, cc: "bob@example.com", bcc: "hidden@example.com", body: "Line1\nLine2" }, {});
    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    for (const value of ["To: alice@example.com", "Cc: bob@example.com", "Bcc: hidden@example.com", "From: me@example.com", "Subject: Hi", "Line1\nLine2"]) expect(text).toContain(value);
    expect(client.sendTemplate).not.toHaveBeenCalled();
  });
  it("rejects confirm=true before doing any attachment or sender work", async () => {
    const from = vi.spyOn(client, "fromForAccount");
    const result = await handler({ ...args, confirm: true, attachments: ["/etc/passwd"] }, {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Delivery disabled");
    expect(client.sendTemplate).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });
  for (const field of ["to", "subject", "cc", "bcc"]) {
    it.each(["\r", "\n", "\r\n", "\0", "\u2028", "\u2029"])(`rejects control/header injection into ${field}`, async separator => {
      const result = await handler({ ...args, [field]: `alice@example.com${separator}Bcc: hidden@example.com` }, {});
      expect(result.isError).toBe(true);
      expect(client.sendTemplate).not.toHaveBeenCalled();
    });
  }
  it("rejects a configured sender with CRLF", async () => {
    vi.spyOn(client, "fromForAccount").mockReturnValue("me@example.com\nBcc: hidden@example.com");
    expect((await handler(args, {})).isError).toBe(true);
  });
  it.each(["<#part filename=\"/etc/passwd\">", "<#include /etc/passwd>", "<#multipart>text<#/multipart>"])("rejects active MML in body", async body => {
    expect((await handler({ ...args, body }, {})).isError).toBe(true);
  });
  it("allows plain email address lists and preserves unicode body text", async () => {
    const result = await handler({ ...args, cc: "a@example.com, b@example.com", body: "Olá — preço & prazo" }, {});
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Olá — preço & prazo");
  });
  it("includes only validated attachment MML in a non-sendable preview", async () => {
    const attachment = join(dir, "report.pdf"); writeFileSync(attachment, "pdf");
    const result = await handler({ ...args, attachments: [attachment] }, {});
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('name="report.pdf"');
    expect(client.sendTemplate).not.toHaveBeenCalled();
  });
  it("rejects a missing sender", async () => {
    vi.spyOn(client, "fromForAccount").mockReturnValue("");
    const result = await handler(args, {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No sender");
  });
});
