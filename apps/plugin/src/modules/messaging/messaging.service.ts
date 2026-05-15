import { singleton } from "tsyringe";
import { logger } from "@/common/logger";
import { runWithEnvelope } from "@/common/utils/tool-envelope";
import { StateStore } from "@/state/state.store";
import type { VkApi } from "@/vk/api";
import { chunkText } from "@/vk/chunk-text";
import { VkClient } from "@/vk/client";
import {
  type DeleteMessageInput,
  type DeleteMessageResult,
  type EditMessageInput,
  type EditMessageResult,
  type MarkReadInput,
  type MarkReadResult,
  type ReactInput,
  type ReactResult,
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
@singleton()
export class MessagingService {
  constructor(
    private readonly vk: VkClient,
    private readonly state: StateStore,
  ) {}

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

  /** Add/replace a reaction on a message via VK `messages.sendReaction`. */
  async react(input: ReactInput): Promise<ReactResult> {
    return runWithEnvelope("react", async () => {
      await this.vk.sendReaction({
        peer_id: input.peer_id,
        cmid: input.conversation_message_id,
        reaction_id: input.reaction_id,
      });
      return { ok: true } as const;
    });
  }

  /** Mark a peer's messages read via VK `messages.markAsRead`. */
  async markRead(input: MarkReadInput): Promise<MarkReadResult> {
    return runWithEnvelope("mark_read", async () => {
      await this.vk.markAsRead({
        peer_id: input.peer_id,
        start_message_id: input.start_message_id,
      });
      return { ok: true } as const;
    });
  }

  private async sendInternal(
    input: SendMessageInput,
    vk: VkApi,
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
      // Feed the recent-messages ring so M4's reply-to-bot detection works.
      await this.state.pushRecentMessage(input.peer_id, res.conversation_message_id);
    }
    logger.info(
      { peer_id: input.peer_id, chunks: chunks.length, first_cmid: cmids[0] },
      "send_message ok",
    );
    return { ok: true, conversation_message_ids: cmids };
  }
}
