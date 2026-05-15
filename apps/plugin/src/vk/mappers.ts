import type { HistoryAttachment, HistoryMessage, SendMessageResponse } from "./api.types";

/**
 * vk-io's `messages.send` returns either a numeric id (single-peer call) or an
 * object. Mirror the numeric into cmid since callers only ever index by cmid.
 */
export function toSendResponse(res: unknown): SendMessageResponse {
  if (typeof res === "number") {
    return { conversation_message_id: res, message_id: res };
  }
  if (typeof res === "object" && res !== null) {
    const obj = res as Record<string, unknown>;
    const cmid = Number(obj.conversation_message_id ?? obj.message_id);
    const mid = Number(obj.message_id ?? obj.conversation_message_id);
    if (Number.isFinite(cmid) && Number.isFinite(mid)) {
      return { conversation_message_id: cmid, message_id: mid };
    }
  }
  throw new Error(`Unexpected messages.send response shape: ${JSON.stringify(res)}`);
}

interface RawHistoryMessage {
  conversation_message_id?: number;
  message_id?: number;
  id?: number;
  from_id: number;
  date: number;
  text?: string;
  reply_message?: { conversation_message_id?: number; id?: number };
  out?: number;
  attachments?: Array<Record<string, unknown>>;
}

/** Strip vk-io's loose message shape to the fields Claude needs. */
export function toHistoryMessage(raw: unknown): HistoryMessage {
  const r = raw as RawHistoryMessage;
  const messageId = r.message_id ?? r.id ?? 0;
  const cmid = r.conversation_message_id ?? messageId;
  const replyCmid = r.reply_message?.conversation_message_id ?? r.reply_message?.id;
  return {
    conversation_message_id: cmid,
    message_id: messageId,
    from_id: r.from_id,
    date: r.date,
    text: r.text ?? "",
    reply_to_cmid: replyCmid,
    out: (r.out ?? 0) === 1 ? 1 : 0,
    attachments: (r.attachments ?? []).map(toHistoryAttachment),
  };
}

interface RawAttachmentBody {
  owner_id?: number;
  id?: number;
  url?: string;
  sizes?: Array<{ url: string }>;
}

export function toHistoryAttachment(att: Record<string, unknown>): HistoryAttachment {
  const type = String(att.type ?? "unknown");
  const body = att[type] as RawAttachmentBody | undefined;
  const ownerId = body?.owner_id ?? 0;
  const id = body?.id ?? 0;
  const vk_ref = `${type}${ownerId}_${id}`;
  // Photos use sizes[].url for largest; docs / audio_message expose .url.
  const url = body?.url ?? body?.sizes?.[body.sizes.length - 1]?.url;
  return { type, vk_ref, url };
}
