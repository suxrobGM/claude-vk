/**
 * Normalized inbound message shape. The router collapses every transport
 * (long poll today, callback API in M6) into this so the gate, attachment
 * downloader, and notifier are transport-agnostic.
 */
export type Attachment = {
  type: string;
  local_path?: string;
  url?: string;
};

export type InboundMessage = {
  peer_id: number;
  from_id: number;
  conversation_message_id: number;
  text: string;
  attachments: Attachment[];
  reply_to?: number;
  is_group_chat: boolean;
  mentioned_bot: boolean;
  received_at: string;
};
