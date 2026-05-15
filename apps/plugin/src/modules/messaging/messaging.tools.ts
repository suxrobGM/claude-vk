import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { injectable } from "tsyringe";
import {
  DeleteMessageInputShape,
  EditMessageInputShape,
  SendMessageInputShape,
  type DeleteMessageInput,
  type EditMessageInput,
  type SendMessageInput,
} from "./messaging.schema";
import { MessagingService } from "./messaging.service";

/**
 * Adapter that exposes `MessagingService` over the MCP tool surface. One
 * `register()` call per process; the MCP SDK validates input against the zod
 * shapes before our handler runs, so the service receives well-typed args.
 */
@injectable()
export class MessagingTools {
  constructor(private readonly service: MessagingService) {}

  register(server: McpServer): void {
    server.registerTool(
      "send_message",
      {
        description:
          "Send a VK message to `peer_id`. Text is auto-chunked at 4096 chars; " +
          "the response's `conversation_message_ids` is an array containing one entry per chunk.",
        inputSchema: SendMessageInputShape,
      },
      async (args: SendMessageInput) => toCallResult(await this.service.send(args)),
    );

    server.registerTool(
      "edit_message",
      {
        description:
          "Edit a previously-sent VK message. Subject to VK's 24-hour and own-message rules.",
        inputSchema: EditMessageInputShape,
      },
      async (args: EditMessageInput) => toCallResult(await this.service.edit(args)),
    );

    server.registerTool(
      "delete_message",
      {
        description:
          "Delete a VK message by `conversation_message_id`. Set `delete_for_all` to remove for both sides (24h window).",
        inputSchema: DeleteMessageInputShape,
      },
      async (args: DeleteMessageInput) => toCallResult(await this.service.delete(args)),
    );
  }
}

function toCallResult(result: { ok: boolean } & Record<string, unknown>): CallToolResult {
  return {
    structuredContent: result,
    content: [{ type: "text", text: JSON.stringify(result) }],
    isError: !result.ok,
  };
}
