import { isGroupChat } from "@/common/utils/peer";
import type { Attachment, InboundMessage } from "./inbound.types";

/**
 * Raw VK `message_new` payload — the shape `vk-io` surfaces under
 * `ctx.payload.message` for each long-poll event. Snake_case, only the
 * fields we consume.
 */
export interface VkMessage {
  id?: number;
  peer_id?: number;
  from_id?: number;
  conversation_message_id?: number;
  text?: string;
  attachments?: VkMessageAttachment[];
  reply_message?: { conversation_message_id?: number; id?: number };
}

export interface VkMessageAttachment {
  type: string;
  photo?: { sizes?: Array<{ url?: string; width?: number; height?: number }> };
  audio_message?: { link_ogg?: string; link_mp3?: string };
  doc?: { url?: string };
}

interface PhotoSize {
  url?: string;
  width?: number;
  height?: number;
}

/**
 * Translate a raw VK `message_new` message payload into our normalized
 * `InboundMessage`. Pure — no I/O, no DI. Tolerates partial payloads: missing
 * peer_id / from_id default to 0 so the downstream gate drops the message
 * rather than crashing. `mentioned_bot` / `is_reply_to_bot` are initialized to
 * false and later enriched by `MentionDetector`.
 */
export function vkMessageToInbound(m: VkMessage | undefined): InboundMessage {
  const msg = m ?? {};
  const messageId = msg.conversation_message_id ?? msg.id ?? 0;
  const replyCmid = msg.reply_message?.conversation_message_id ?? msg.reply_message?.id;
  const attachments: Attachment[] = (msg.attachments ?? []).map((a) => ({
    type: a.type,
    url: pickAttachmentUrl(a),
  }));
  const peerId = msg.peer_id ?? 0;
  return {
    peer_id: peerId,
    from_id: msg.from_id ?? 0,
    conversation_message_id: messageId,
    text: msg.text ?? "",
    attachments,
    reply_to: replyCmid,
    is_group_chat: isGroupChat(peerId),
    mentioned_bot: false,
    is_reply_to_bot: false,
    received_at: new Date().toISOString(),
  };
}

function pickAttachmentUrl(a: VkMessageAttachment): string | undefined {
  if (a.type === "photo" && a.photo?.sizes?.length) {
    return pickLargestPhotoUrl(a.photo.sizes);
  }
  if (a.type === "audio_message") {
    return a.audio_message?.link_ogg ?? a.audio_message?.link_mp3;
  }
  if (a.type === "doc") {
    return a.doc?.url;
  }
  return undefined;
}

function pickLargestPhotoUrl(sizes: PhotoSize[]): string | undefined {
  // VK orders sizes ascending, so `>=` lets the last entry win ties — which
  // doubles as a fallback when width/height are absent (every entry has area 0).
  let best: PhotoSize | null = null;
  let bestArea = -1;

  for (const s of sizes) {
    if (!s.url) {
      continue;
    }
    const area = (s.width ?? 0) * (s.height ?? 0);
    if (area >= bestArea) {
      best = s;
      bestArea = area;
    }
  }
  return best?.url;
}
