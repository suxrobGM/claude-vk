import { isGroupChat } from "@/common/utils/peer";
import type { Attachment, InboundMessage } from "./inbound.types";

/**
 * Minimal shape this module accepts from any transport. The long-poll
 * adapter and (future) webhook adapter both flatten their own context into
 * this before calling `normalize`, so the rest of the inbound pipeline
 * stays free of vk-io types.
 */
export type RawInbound = {
  peer_id: number;
  from_id: number;
  conversation_message_id: number | undefined;
  message_id?: number;
  text: string | undefined;
  attachments?: RawAttachment[];
  reply?: { conversation_message_id?: number; message_id?: number };
};

export type RawAttachment = {
  type: string;
  /**
   * Optional URL the file can be fetched from. Photos pass the
   * largest-size URL; voice/audio_message use the OGG URL; docs use
   * the doc URL. Anything else passes whatever it has.
   */
  url?: string;
};

/**
 * Pure normalizer. No I/O, no DI — safe to call from any context including
 * tests with synthetic payloads.
 */
export function normalize(raw: RawInbound): InboundMessage {
  const cmid = raw.conversation_message_id ?? raw.message_id ?? 0;
  const replyCmid = raw.reply?.conversation_message_id ?? raw.reply?.message_id;
  const attachments: Attachment[] = (raw.attachments ?? []).map((a) => ({
    type: a.type,
    url: a.url,
  }));
  return {
    peer_id: raw.peer_id,
    from_id: raw.from_id,
    conversation_message_id: cmid,
    text: raw.text ?? "",
    attachments,
    reply_to: replyCmid,
    is_group_chat: isGroupChat(raw.peer_id),
    mentioned_bot: false, // M4 sets this
    received_at: new Date().toISOString(),
  };
}
