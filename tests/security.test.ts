import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, linkSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, TOOL_COUNT } from "../src/index.js";
import { CAPABILITIES, DELIVERY_DISABLED, loadCapabilities, restrictTools } from "../src/security.js";
import { HimalayaClient } from "../src/himalaya/client.js";
import { checkedAttachment, MAX_ATTACHMENT_BYTES, readRegularFile, writeExport } from "../src/safe-files.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerActionTools } from "../src/tools/actions.js";
import { registerRenderTools } from "../src/tools/render.js";

const READ_TOOLS = ["create_action_item", "export_to_markdown", "get_unread_count", "health_check", "list_emails", "list_folders", "list_starred", "list_threads", "read_email", "read_thread", "render_email", "search_emails"].sort();
function tools(server: McpServer): Record<string, any> { return (server as any)._registeredTools; }

describe("operator capability boundary", () => {
  beforeEach(() => { vi.stubEnv("HIMALAYA_CAPABILITIES", ""); vi.stubEnv("HIMALAYA_FROM", "test@example.com"); });
  afterEach(() => vi.unstubAllEnvs());

  it("registers exactly the read-only set by default", () => {
    expect(Object.keys(tools(createServer())).sort()).toEqual(READ_TOOLS);
    expect(TOOL_COUNT).toBe(READ_TOOLS.length);
  });
  it.each(["send", "all", "true", "mailbox_write", "${CAPABILITIES}"])("fails closed on unknown capability %s", value => {
    vi.stubEnv("HIMALAYA_CAPABILITIES", value);
    expect(() => createServer()).toThrow("Unknown HIMALAYA_CAPABILITIES");
  });
  it("drafts opt-in does not grant filesystem or mailbox writes", () => {
    vi.stubEnv("HIMALAYA_CAPABILITIES", "drafts");
    expect(Object.keys(tools(createServer())).sort()).toEqual([...READ_TOOLS, "draft_reply", "compose_email", "send_email"].sort());
  });
  it("mailbox-write opt-in does not enable drafts or desktop integrations", () => {
    vi.stubEnv("HIMALAYA_CAPABILITIES", "mailbox-write");
    expect(Object.keys(tools(createServer())).sort()).toEqual([...READ_TOOLS, "flag_email", "move_email", "create_folder", "delete_folder"].sort());
  });
  it("rejects an unclassified new tool", () => {
    const server = restrictTools(new McpServer({ name: "test", version: "0" }));
    expect(() => server.registerTool("new_unreviewed_tool", {}, async () => ({ content: [] }))).toThrow("Unclassified");
  });
  it("all capability switches still cannot enable delivery", async () => {
    vi.stubEnv("HIMALAYA_CAPABILITIES", CAPABILITIES.join(","));
    const server = createServer();
    for (const name of ["send_email", "compose_email"]) {
      const args = name === "send_email" ? { template: "To: a@b.com\nSubject: Test\n\nhello", confirm: true } : { to: "a@b.com", subject: "Test", body: "hello", confirm: true };
      const result = await tools(server)[name].handler(args, {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Delivery disabled");
    }
    expect(tools(server).snooze_email).toBeUndefined();
  });
  it.each([["template", "send"], ["message", "send"], ["message", "add"], ["imap", "append"]])("blocks direct client command %j before executing a process", async (...command) => {
    const client = new HimalayaClient();
    const probe = vi.spyOn(client, "resolveVersion");
    await expect(client.exec(command)).rejects.toThrow();
    expect(probe).not.toHaveBeenCalled();
  });
  it("blocks sendTemplate without even a version probe", async () => {
    const client = new HimalayaClient();
    const probe = vi.spyOn(client, "resolveVersion");
    await expect(client.sendTemplate("To: a@b.com\n\nhello")).rejects.toThrow(DELIVERY_DISABLED);
    expect(probe).not.toHaveBeenCalled();
  });
  it("rejects mailbox writes without a capability", async () => {
    const client = new HimalayaClient();
    const probe = vi.spyOn(client, "resolveVersion");
    await expect(client.moveMessage("1", "Trash")).rejects.toThrow("Capability disabled");
    await expect(client.flagMessage("1", ["Seen"], "add")).rejects.toThrow("Capability disabled");
    await expect(client.createFolder("test")).rejects.toThrow("Capability disabled");
    expect(probe).not.toHaveBeenCalled();
  });
  it("the low-level single-attempt seam also refuses delivery commands", async () => {
    const client = new HimalayaClient();
    const probe = vi.spyOn(client, "resolveVersion");
    await expect((client as any).execOnce(["template", "send"])).rejects.toThrow("Delivery disabled");
    expect(probe).not.toHaveBeenCalled();
  });
  it("binds all reads to the operator-selected account", async () => {
    const client = new HimalayaClient({ account: "work" });
    const probe = vi.spyOn(client, "resolveVersion");
    await expect(client.exec(["envelope", "list"], { account: "personal" })).rejects.toThrow("Account override");
    expect(() => client.fromForAccount("personal")).toThrow("Account override");
    expect(probe).not.toHaveBeenCalled();
  });
  it("render_email uses no HTML export by default", async () => {
    const server = new McpServer({ name: "test", version: "0" });
    const client = new HimalayaClient();
    vi.spyOn(client, "readMessage").mockResolvedValue(JSON.stringify("safe text"));
    const html = vi.spyOn(client, "readMessageHtml");
    registerRenderTools(server, client);
    expect((await tools(server).render_email.handler({ id: "1" }, {})).content[0].text).toBe("safe text");
    expect(html).not.toHaveBeenCalled();
  });
});

describe("filesystem boundary", () => {
  let base: string, root: string, outside: string;
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "himalaya-security-"));
    root = join(base, "allowed"); mkdirSync(root, { mode: 0o700 });
    outside = join(base, "secret.txt"); writeFileSync(outside, "do not disclose");
    vi.stubEnv("HIMALAYA_CAPABILITIES", "attachments,export");
    vi.stubEnv("HIMALAYA_ATTACHMENT_ROOT", root);
    vi.stubEnv("HIMALAYA_EXPORT_ROOT", root);
  });
  afterEach(() => { vi.unstubAllEnvs(); rmSync(base, { recursive: true, force: true }); });
  it("allows a regular file inside the dedicated root", () => {
    const path = join(root, "report.txt"); writeFileSync(path, "report");
    expect(checkedAttachment(path)).toContain("report.txt");
  });
  it("rejects files outside the root and sibling-prefix tricks", () => {
    expect(() => checkedAttachment(outside)).toThrow("outside");
    expect(() => checkedAttachment(join(root, "..", "secret.txt"))).toThrow("outside");
    const sibling = root + "-evil"; mkdirSync(sibling); writeFileSync(join(sibling, "secret"), "secret");
    expect(() => checkedAttachment(join(sibling, "secret"))).toThrow("outside");
  });
  it("rejects symlink and hardlink escapes", () => {
    const link = join(root, "link.txt"); symlinkSync(outside, link);
    expect(() => checkedAttachment(link)).toThrow();
    const hard = join(root, "hard.txt"); linkSync(outside, hard);
    expect(() => checkedAttachment(hard)).toThrow();
    const dir = join(root, "dir"); symlinkSync(base, dir);
    expect(() => checkedAttachment(join(dir, "secret.txt"))).toThrow("outside");
  });
  it.each(['bad".txt', 'bad<part>.txt', 'bad\\path.txt', 'bad\nname.txt'])("rejects MML-unsafe filename %j", name => {
    const path = join(root, name); writeFileSync(path, "hello");
    expect(() => checkedAttachment(path)).toThrow("Unsafe attachment");
  });
  it("rejects MML-unsafe canonical paths behind intermediate symlinks", () => {
    const unsafe = join(root, 'bad"directory'); mkdirSync(unsafe);
    writeFileSync(join(unsafe, "report.txt"), "data");
    symlinkSync(unsafe, join(root, "safe-name"));
    expect(() => checkedAttachment(join(root, "safe-name", "report.txt"))).toThrow("Unsafe canonical");
  });
  it("rejects directories and oversized files", () => {
    const dir = join(root, "dir"); mkdirSync(dir);
    expect(() => checkedAttachment(dir)).toThrow();
    const large = join(root, "large.txt"); writeFileSync(large, Buffer.alloc(MAX_ATTACHMENT_BYTES + 1));
    expect(() => checkedAttachment(large)).toThrow();
  });
  it("does not read an export symlink or a directory", () => {
    const link = join(root, "output.eml"); symlinkSync(outside, link);
    expect(() => readRegularFile(link)).toThrow();
    expect(() => readRegularFile(root)).toThrow();
  });
  it("writes a new private export and never overwrites an existing file", () => {
    const path = writeExport("actions.md", "first");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(() => writeExport("actions.md", "second")).toThrow();
    expect(readFileSync(path, "utf8")).toBe("first");
  });
  it.each(["../secret.txt", "/tmp/escape.md", "a/b.md", "a\\b.md", ".", ".."])("rejects export traversal %j", name => {
    expect(() => writeExport(name, "overwrite")).toThrow();
    expect(readFileSync(outside, "utf8")).toBe("do not disclose");
  });
  it("does not follow an existing export symlink", () => {
    symlinkSync(outside, join(root, "actions.md"));
    expect(() => writeExport("actions.md", "overwrite")).toThrow();
    expect(readFileSync(outside, "utf8")).toBe("do not disclose");
  });
  it("requires explicit filesystem capabilities and roots", () => {
    vi.stubEnv("HIMALAYA_CAPABILITIES", "");
    expect(() => writeExport("actions.md", "x")).toThrow("Capability disabled");
    expect(() => checkedAttachment(outside)).toThrow("Capability disabled");
    vi.stubEnv("HIMALAYA_CAPABILITIES", "export"); vi.stubEnv("HIMALAYA_EXPORT_ROOT", "");
    expect(() => writeExport("actions.md", "x")).toThrow("HIMALAYA_EXPORT_ROOT");
  });
  it("create_action_item reports an export failure without overwriting", async () => {
    const server = new McpServer({ name: "test", version: "0" });
    const client = new HimalayaClient();
    vi.spyOn(client, "listEnvelopes").mockResolvedValue("[]");
    vi.spyOn(client, "readMessage").mockResolvedValue(JSON.stringify("todo"));
    registerActionTools(server, client);
    const result = await tools(server).create_action_item.handler({ id: "1", destination: outside }, {});
    expect(result.isError).toBe(true);
    expect(readFileSync(outside, "utf8")).toBe("do not disclose");
  });
});
