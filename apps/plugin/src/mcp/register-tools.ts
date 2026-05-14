import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Each module that exposes MCP tools defines a register fn and is invoked here.
 * M0 only has the inline `ping` smoke-test tool — messaging/history/users
 * registrations arrive in M1+.
 */
export function registerAllTools(server: McpServer): void {
  server.registerTool(
    "ping",
    {
      description: "Smoke-test tool. Returns 'pong'. Used to verify the channel is connected.",
      inputSchema: {},
    },
    async () => ({
      content: [{ type: "text", text: "pong" }],
    }),
  );
}
