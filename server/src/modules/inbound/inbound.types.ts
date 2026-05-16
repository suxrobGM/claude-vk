/**
 * Normalized inbound message shape. `message-adapter` translates `vk-io`'s
 * long-poll `message_new` payload into this so the gate, attachment
 * downloader, and notifier are transport-agnostic.
 */
export interface Attachment {
  type: string;
  local_path?: string;
  url?: string;
}

export interface InboundMessage {
  peer_id: number;
  from_id: number;
  conversation_message_id: number;
  text: string;
  attachments: Attachment[];
  reply_to?: number;
  /** `from_id` of the quoted message — negative for community-sent messages. */
  reply_to_from_id?: number;
  is_group_chat: boolean;
  /** Any attention signal: text mention or reply-to-bot. Used by `mention_only`. */
  mentioned_bot: boolean;
  /** `reply_to` matches a message the bot sent. Used by `reply_only`. */
  is_reply_to_bot: boolean;
  /** Raw JSON string from a tapped inline-keyboard button. Consumed by the permission relay. */
  payload?: string;
  received_at: string;
}
