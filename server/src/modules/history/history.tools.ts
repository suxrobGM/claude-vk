import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { singleton } from "tsyringe";
import { toCallResult } from "@/common/utils/tool-envelope";
import {
  GetHistoryInputShape,
  SearchMessagesInputShape,
  type GetHistoryInput,
  type SearchMessagesInput,
} from "./history.schema";
import { HistoryService } from "./history.service";

/** MCP adapter for `HistoryService`. Same shape as `MessagingTools`. */
@singleton()
export class HistoryTools {
  constructor(private readonly service: HistoryService) {}

  register(server: McpServer): void {
    server.registerTool(
      "get_conversation_history",
      {
        description:
          "Fetch the last N messages of a peer (default 20, max 200). Returns " +
          "normalized items with `vk_ref` per attachment. Set `extended` to also " +
          "resolve participating users into `profiles[]`.",
        inputSchema: GetHistoryInputShape,
      },
      async (args: GetHistoryInput) =>
        toCallResult(await this.service.getConversationHistory(args)),
    );

    server.registerTool(
      "search_messages",
      {
        description:
          "Full-text search across the bound identity's conversations via VK " +
          "`messages.search`. Optional `peer_id` scopes to one chat.",
        inputSchema: SearchMessagesInputShape,
      },
      async (args: SearchMessagesInput) => toCallResult(await this.service.searchMessages(args)),
    );
  }
}
