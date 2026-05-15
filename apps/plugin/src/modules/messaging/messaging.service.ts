import { injectable } from "tsyringe";
import { PluginError, VkApiError } from "@/common/errors";
import { logger } from "@/common/logger";
import { chunkText } from "@/vk/chunk-text";
import { VkClient, type ApiContract } from "@/vk/client";
import {
  type DeleteMessageInput,
  type DeleteMessageResult,
  type EditMessageInput,
  type EditMessageResult,
  type SendMessageInput,
  type SendMessageResult,
} from "./messaging.schema";
import { nextRandomId } from "./random-id";

/**
 * Outbound VK messaging operations. Each method returns the structured
 * `{ ok, ... }` envelope the MCP tool layer hands back to Claude — never
 * throws for VK-side failures, which lets Claude reason about retry vs. ask.
 * Unexpected (non-VK) errors propagate so the tool wrapper can log them and
 * surface a generic error envelope.
 */
@injectable()
export class MessagingService {
  constructor(private readonly vk: VkClient) {}

  /**
   * Sends `text` to `peer_id`, auto-chunked at 4096 chars. Returns every
   * resulting `conversation_message_id` in send order. `reply_to` only attaches
   * to the first chunk (subsequent chunks read as natural follow-ups in VK's
   * UI). Partial sends on the wire when a later chunk fails are NOT rolled back.
   */
  async send(input: SendMessageInput): Promise<SendMessageResult> {
    return runWithEnvelope("send_message", async () => this.sendInternal(input, this.vk));
  }

  /** Edits a previously-sent message. VK enforces the 24h / own-messages rules; errors surface via envelope. */
  async edit(input: EditMessageInput): Promise<EditMessageResult> {
    return runWithEnvelope("edit_message", async () => {
      await this.vk.editMessage({
        peer_id: input.peer_id,
        conversation_message_id: input.conversation_message_id,
        message: input.text,
      });
      return { ok: true } as const;
    });
  }

  /** Deletes a message. `delete_for_all` is bound by VK's 24h window. */
  async delete(input: DeleteMessageInput): Promise<DeleteMessageResult> {
    return runWithEnvelope("delete_message", async () => {
      await this.vk.deleteMessage({
        peer_id: input.peer_id,
        conversation_message_ids: [input.conversation_message_id],
        delete_for_all: input.delete_for_all ? 1 : 0,
      });
      return { ok: true } as const;
    });
  }

  private async sendInternal(
    input: SendMessageInput,
    vk: ApiContract,
  ): Promise<{ ok: true; conversation_message_ids: number[] }> {
    const chunks = chunkText(input.text);
    const cmids: number[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      const res = await vk.sendMessage({
        peer_id: input.peer_id,
        message: chunk,
        reply_to: i === 0 ? input.reply_to : undefined,
        random_id: nextRandomId(),
      });
      cmids.push(res.conversation_message_id);
    }
    logger.info(
      { peer_id: input.peer_id, chunks: chunks.length, first_cmid: cmids[0] },
      "send_message ok",
    );
    return { ok: true, conversation_message_ids: cmids };
  }
}

/**
 * Wraps a tool body with the shared envelope translation: known errors collapse
 * into structured `{ ok: false }` results; unknown errors are logged and
 * returned as `{ ok: false, code: "internal_error" }` rather than propagated,
 * so MCP never closes the connection on a tool exception.
 */
async function runWithEnvelope<R extends { ok: true }>(
  tool: string,
  body: () => Promise<R>,
): Promise<R | { ok: false; code: string; message: string; vk_error_code?: number }> {
  try {
    return await body();
  } catch (err) {
    if (err instanceof VkApiError) {
      logger.warn({ tool, code: err.code, vk_error_code: err.vkErrorCode }, "vk error");
      return {
        ok: false,
        code: err.code,
        message: err.message,
        vk_error_code: err.vkErrorCode,
      };
    }
    if (err instanceof PluginError) {
      logger.warn({ tool, code: err.code }, "plugin error");
      return { ok: false, code: err.code, message: err.message };
    }
    logger.error({ tool, err }, "unexpected tool error");
    return {
      ok: false,
      code: "internal_error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
