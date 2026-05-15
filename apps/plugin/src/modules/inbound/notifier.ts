import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { logger } from "@/common/logger";
import type { InboundMessage } from "./inbound.types";

/**
 * Translates `InboundMessage` into MCP `notifications/claude/channel` events.
 * Claude Code sets the `source` attribute from the MCP server name ("vk");
 * we only fill `meta`. Meta keys must be snake_case (hyphens are dropped).
 */
export class ChannelNotifier {
  constructor(private readonly mcp: McpServer) {}

  /** Emit a `<channel source="vk" ...>...</channel>` event for one message. */
  async notify(msg: InboundMessage, fromName: string): Promise<void> {
    const localPaths = msg.attachments
      .map((a) => a.local_path)
      .filter((p): p is string => Boolean(p));
    const trailer =
      localPaths.length > 0
        ? `\n\n[attachments saved to inbox: ${localPaths.join(", ")}]`
        : msg.attachments.length > 0
          ? `\n\n[attachments (not downloaded): ${msg.attachments.map((a) => a.type).join(", ")}]`
          : "";

    const meta: Record<string, string> = {
      peer_id: String(msg.peer_id),
      from_id: String(msg.from_id),
      from_name: fromName,
      is_group_chat: String(msg.is_group_chat),
      conversation_message_id: String(msg.conversation_message_id),
      mentioned: String(msg.mentioned_bot),
      reply_to_bot: String(msg.is_reply_to_bot),
    };
    if (msg.reply_to !== undefined) meta.reply_to = String(msg.reply_to);

    try {
      await this.mcp.server.notification({
        method: "notifications/claude/channel",
        params: { content: msg.text + trailer, meta },
      });
    } catch (err) {
      logger.warn({ err }, "channel notification failed");
    }
  }

  /** Emit a warning-tagged channel event. Used by the long-poll loop for transient failures. */
  async warn(content: string): Promise<void> {
    try {
      await this.mcp.server.notification({
        method: "notifications/claude/channel",
        params: { content, meta: { severity: "warning" } },
      });
    } catch (err) {
      logger.warn({ err }, "channel warning notification failed");
    }
  }
}
