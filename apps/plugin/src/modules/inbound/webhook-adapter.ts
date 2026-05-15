import type { RawAttachment, RawInbound } from "./router";

/**
 * VK Callback API `message_new` object. Mirrors only the fields we consume —
 * snake_case throughout, in contrast to vk-io's camelCase Long Poll context.
 * Sibling to `vkContextToRaw` in `vk/long-poll.ts` (long-poll's equivalent
 * adapter), but kept here because the Callback shape is module-local concern.
 */
export interface VkCallbackMessageNewObject {
  message?: VkCallbackMessage;
}

export interface VkCallbackMessage {
  id?: number;
  peer_id?: number;
  from_id?: number;
  conversation_message_id?: number;
  text?: string;
  attachments?: VkCallbackAttachment[];
  reply_message?: { conversation_message_id?: number; id?: number };
}

export interface VkCallbackAttachment {
  type: string;
  photo?: { sizes?: Array<{ url?: string; width?: number; height?: number }> };
  audio_message?: { link_ogg?: string; link_mp3?: string };
  doc?: { url?: string };
}

/**
 * Translate a VK Callback API `message_new.object` payload into the
 * transport-agnostic `RawInbound` shape. Pure — no I/O, no DI. Tolerates
 * partial payloads: missing peer_id / from_id default to 0 so the downstream
 * gate drops the message rather than crashing.
 */
export function webhookMessageNewToRaw(object: VkCallbackMessageNewObject): RawInbound {
  const m = object.message ?? {};
  const attachments: RawAttachment[] = (m.attachments ?? []).map((a) => ({
    type: a.type,
    url: pickAttachmentUrl(a),
  }));
  return {
    peer_id: m.peer_id ?? 0,
    from_id: m.from_id ?? 0,
    conversation_message_id: m.conversation_message_id,
    message_id: m.id,
    text: m.text,
    attachments,
    reply: m.reply_message
      ? {
          conversation_message_id: m.reply_message.conversation_message_id,
          message_id: m.reply_message.id,
        }
      : undefined,
  };
}

function pickAttachmentUrl(a: VkCallbackAttachment): string | undefined {
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

function pickLargestPhotoUrl(
  sizes: Array<{ url?: string; width?: number; height?: number }>,
): string | undefined {
  // VK orders sizes ascending, so `>=` lets the last entry win ties — which
  // doubles as a fallback when width/height are absent (every entry has area 0).
  let best: { url?: string; width?: number; height?: number } | undefined;
  let bestArea = -1;
  for (const s of sizes) {
    if (!s.url) continue;
    const area = (s.width ?? 0) * (s.height ?? 0);
    if (area >= bestArea) {
      best = s;
      bestArea = area;
    }
  }
  return best?.url;
}
