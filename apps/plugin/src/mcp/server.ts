import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { logger } from "@/common/logger";
import { buildCapabilities } from "./capabilities";
import { registerAllTools } from "./register-tools";

let ready = false;

export function isReady(): boolean {
  return ready;
}

export async function startMcpServer(): Promise<McpServer> {
  const server = new McpServer(
    { name: "vk", version: "0.1.0" },
    {
      capabilities: buildCapabilities(),
      instructions:
        "VK channel plugin (M0 skeleton). Messages from VK will arrive as " +
        '<channel source="vk" peer_id="..." from_id="..."> blocks once the ' +
        "inbound transport lands in M2. Use the `ping` tool to verify connectivity.",
    },
  );

  registerAllTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  ready = true;
  logger.info("mcp server connected over stdio");
  return server;
}
