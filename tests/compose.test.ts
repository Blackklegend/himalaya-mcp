import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { HimalayaClient } from "../src/himalaya/client.js";
import { registerComposeTools } from "../src/tools/compose.js";

const template = "From: me@example.com\nTo: alice@example.com\nSubject: Hello\n\nHello Alice";
let client: HimalayaClient, tools: Record<string, any>;
beforeEach(() => {
  const server = new McpServer({ name: "test", version: "0" });
  client = new HimalayaClient({ from: "me@example.com" });
  vi.spyOn(client, "replyTemplate").mockResolvedValue(JSON.stringify(template));
  vi.spyOn(client, "sendTemplate").mockResolvedValue("{}");
  registerComposeTools(server, client);
  tools = (server as any)._registeredTools;
});
afterEach(() => vi.restoreAllMocks());

describe("preview-only compose tools", () => {
  it("generates reply drafts with account/folder/body preserved", async () => {
    const result = await tools.draft_reply.handler({ id: "42", body: "Thanks", reply_all: true, folder: "Inbox", account: "work" }, {});
    expect(result.content[0].text).toContain(template);
    expect(client.replyTemplate).toHaveBeenCalledWith("42", "Thanks", true, "Inbox", "work");
    expect(client.sendTemplate).not.toHaveBeenCalled();
  });
  it.each([undefined, false])("previews with confirm=%s and never delivers", async confirm => {
    const result = await tools.send_email.handler({ template, confirm }, {});
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain(template);
    expect(result.content[0].text).toContain("Delivery is disabled");
    expect(client.sendTemplate).not.toHaveBeenCalled();
  });
  it("rejects first-call confirm=true even if SMTP is mocked to succeed", async () => {
    const result = await tools.send_email.handler({ template, confirm: true }, {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Delivery disabled");
    expect(client.sendTemplate).not.toHaveBeenCalled();
  });
  it("a preview does not authorize a later confirm=true", async () => {
    await tools.send_email.handler({ template }, {});
    const result = await tools.send_email.handler({ template, confirm: true, account: "work", approval_token: "fake" }, {});
    expect(result.isError).toBe(true);
    expect(client.sendTemplate).not.toHaveBeenCalled();
  });
  it.each([
    "To: alice@example.com\nSubject: Hi\nBcc: bob@example.com\nBcc: other@example.com\n\nBody",
    "To: alice@example.com\nSubject: Hi\n X-Folded: bad\n\nBody",
    "To: alice@example.com\nSubject: Hi\rBcc: hidden@example.com\n\nBody",
    "To: alice@example.com\nSubject: Hi\nContent-Type: multipart/mixed\n\nBody",
    "To: alice@example.com\nSubject: Hi\n\n<#part filename=\"/etc/passwd\">",
    "To: alice@example.com\nSubject: Hi\n\n<#include /etc/passwd>",
    "not a full template",
  ])("rejects active MML or ambiguous raw templates", async input => {
    const result = await tools.send_email.handler({ template: input }, {});
    expect(result.isError).toBe(true);
    expect(client.sendTemplate).not.toHaveBeenCalled();
  });
  it("accepts CRLF-separated headers for preview only", async () => {
    const result = await tools.send_email.handler({ template: template.replaceAll("\n", "\r\n") }, {});
    expect(result.isError).toBeUndefined();
    expect(client.sendTemplate).not.toHaveBeenCalled();
  });
});
