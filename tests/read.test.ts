import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { HimalayaClient } from "../src/himalaya/client.js";
import { registerReadTools } from "../src/tools/read.js";
import messageV2 from "./fixtures/message-v2.json";

describe("read_email MCP protocol", () => {
  let client: Client;
  let server: McpServer;
  let himalaya: HimalayaClient;

  beforeEach(async () => {
    himalaya = new HimalayaClient();
    vi.spyOn(himalaya, "readMessage").mockResolvedValue(JSON.stringify(messageV2));
    server = new McpServer({ name: "test", version: "0.0.0" });
    registerReadTools(server, himalaya);
    client = new Client({ name: "test", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
    vi.restoreAllMocks();
  });

  it("returns a schema-valid text block for the v2 message structure", async () => {
    const result = await client.callTool({
      name: "read_email", arguments: { account: "work", folder: "Inbox", id: "2969" },
    });
    expect(result.isError).toBeUndefined();
    expect(result.content).toEqual([{
      type: "text", text: "Hello from the plain text part.\n\nSecond paragraph.",
    }]);
    expect(himalaya.readMessage).toHaveBeenCalledWith("2969", "Inbox", "work");
  });

  it("continues to read v1 JSON strings", async () => {
    vi.mocked(himalaya.readMessage).mockResolvedValue(JSON.stringify("Legacy message"));
    const result = await client.callTool({ name: "read_email", arguments: { id: "1" } });
    expect(result.content).toEqual([{ type: "text", text: "Legacy message" }]);
  });

  it("returns a schema-valid error for unsupported structured responses", async () => {
    vi.mocked(himalaya.readMessage).mockResolvedValue('{"unexpected":"shape"}');
    const result = await client.callTool({ name: "read_email", arguments: { id: "1" } });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{
      type: "text", text: expect.stringContaining('"code": "parse_error"'),
    }]);
  });
});
