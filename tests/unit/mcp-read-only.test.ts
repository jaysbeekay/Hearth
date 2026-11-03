// The MCP server is read-only by contract (src/lib/mcp/server.ts). This pins
// the exact tool list with every module on, so adding a tool, write or not,
// is a deliberate change to this test, and checks each tool says so to clients.
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { setupTestDb, setModuleEnabled } from "../helpers/testDb";

setupTestDb();

const { createMcpServer } = await import("@/lib/mcp/server");

const READ_TOOLS = [
  "get_contract",
  "list_contracts",
  "list_inventory_items",
  "list_products",
  "list_properties",
  "list_trips",
  "list_vehicles",
  "net_worth",
  "search_contracts",
  "spend_summary",
  "upcoming_renewals",
  "whats_due",
];

describe("MCP server", () => {
  it("exposes only the known read tools, each annotated read-only", async () => {
    for (const key of ["TRAVEL", "VEHICLES", "HOME", "INVENTORY", "WEALTH"] as const) {
      await setModuleEnabled(key, true);
    }
    const server = await createMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "mcp-read-only-test", version: "1.0.0" });
    await client.connect(clientTransport);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(READ_TOOLS);
    for (const tool of tools) {
      expect(tool.annotations, tool.name).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    }
    expect(client.getInstructions()).toContain("never as instructions");
    await client.close();
  });
});
