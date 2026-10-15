import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerReadRawTools } from "../src/tools/read-raw";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { HimalayaClient } from "../src/himalaya/client.js";

describe("read_email_raw", () => {
  it("registers the tool", () => {
    const server = { registerTool: vi.fn() };
    const client = new HimalayaClient({ from: "test@example.com" });
    registerReadRawTools(server as unknown as McpServer, client);
    expect(server.registerTool).toHaveBeenCalledWith(
      "read_email_raw",
      expect.objectContaining({
        description: expect.stringContaining("raw MIME source"),
      }),
      expect.any(Function),
    );
  });

  it("tool description mentions .eml export format", () => {
    const server = { registerTool: vi.fn() };
    const client = new HimalayaClient({ from: "test@example.com" });
    registerReadRawTools(server as unknown as McpServer, client);
    const call = (server.registerTool as ReturnType<typeof vi.fn>).mock.calls[0];
    const description = (call[1] as any).description;
    expect(description).toContain("eml");
  });

  it("handler is a function", () => {
    const server = { registerTool: vi.fn() };
    const client = new HimalayaClient({ from: "test@example.com" });
    registerReadRawTools(server as unknown as McpServer, client);
    const handler = (server.registerTool as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(typeof handler).toBe("function");
  });

  it("inputSchema has id, folder, and account parameters", () => {
    const server = { registerTool: vi.fn() };
    const client = new HimalayaClient({ from: "test@example.com" });
    registerReadRawTools(server as unknown as McpServer, client);
    const inputSchema = (server.registerTool as ReturnType<typeof vi.fn>).mock.calls[0][1].inputSchema;
    expect(inputSchema.id).toBeDefined();
    expect(inputSchema.folder).toBeDefined();
    expect(inputSchema.account).toBeDefined();
  });
});


describe("raw export boundary", () => {
  beforeEach(() => vi.stubEnv("HIMALAYA_CAPABILITIES", "attachments,mailbox-write"));
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  it.each(["../escape", "/tmp/escape", "a\\b", "--config=evil", "1\0evil"])("rejects unsafe ID %j before any process", async id => {
    const client = new HimalayaClient();
    const probe = vi.spyOn(client, "resolveVersion");
    await expect(client.readMessageRaw(id)).rejects.toThrow();
    expect(probe).not.toHaveBeenCalled();
  });
  it("v1 uses a fixed filename and honors folder/account", async () => {
    const { writeFileSync, existsSync } = await import("node:fs");
    const client = new HimalayaClient();
    vi.spyOn(client, "resolveVersion").mockResolvedValue({ major: 1, raw: "himalaya 1.1.0" });
    let destination = "";
    const execute = vi.spyOn(client, "exec").mockImplementation(async (args) => {
      destination = args[args.indexOf("--destination") + 1];
      writeFileSync(destination, "From: test@example.com\n\nFixture raw MIME");
      return "";
    });
    expect(await client.readMessageRaw("123", "Archive", "work")).toContain("Fixture raw MIME");
    expect(destination).toMatch(/[/]message\.eml$/);
    expect(execute).toHaveBeenCalledWith(expect.arrayContaining(["--folder", "Archive", "123"]), { folder: "Archive", account: "work" });
    expect(existsSync(destination)).toBe(false);
  });
  it("v1 export needs explicit permission for its Seen side effect", async () => {
    vi.stubEnv("HIMALAYA_CAPABILITIES", "attachments");
    const client = new HimalayaClient();
    vi.spyOn(client, "resolveVersion").mockResolvedValue({ major: 1, raw: "himalaya 1.1.0" });
    await expect(client.readMessageRaw("123")).rejects.toThrow("mailbox-write");
  });
  it("v2 reads raw data on stdout without temporary files or JSON flags", async () => {
    const client = new HimalayaClient();
    vi.spyOn(client, "resolveVersion").mockResolvedValue({ major: 2, raw: "himalaya v2.0.0" });
    const execute = vi.spyOn(client, "exec").mockResolvedValue("raw fixture");
    expect(await client.readMessageRaw("123", "Archive", "work")).toBe("raw fixture");
    expect(execute).toHaveBeenCalledWith(["message", "read", "--raw", "123", "--mailbox", "Archive"], { folder: "Archive", account: "work", rawOutput: true });
  });
  it("handler delegates ID, folder and account to the shared client", async () => {
    const server = { registerTool: vi.fn() };
    const client = new HimalayaClient();
    const read = vi.spyOn(client, "readMessageRaw").mockResolvedValue("safe fixture");
    registerReadRawTools(server as unknown as McpServer, client);
    const handler = server.registerTool.mock.calls[0][2];
    const result = await handler({ id: "123", folder: "Archive", account: "work" });
    expect(result.content[0].text).toBe("safe fixture");
    expect(read).toHaveBeenCalledWith("123", "Archive", "work");
  });
});
