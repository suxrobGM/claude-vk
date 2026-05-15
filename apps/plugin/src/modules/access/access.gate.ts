import { singleton } from "tsyringe";
import type { InboundMessage } from "@/modules/inbound/inbound.types";
import { AccessStore } from "./access.store";

export type GateResult =
  | { kind: "allow" }
  | { kind: "need_pair" }
  | { kind: "deny_with_reply"; reason: string }
  | { kind: "drop"; reason: string };

/**
 * PRD §9.4 gate: chat allowlist → sender allowlist → mention activation
 * (group chats only). An empty `senders[]` means "no per-sender restriction"
 * — anyone in this chat passes the sender layer. Under `allowlist`, DM
 * denials surface as `deny_with_reply` (one reply per sender); group-chat
 * denials stay silent.
 */
@singleton()
export class AccessGate {
  constructor(private readonly access: AccessStore) {}

  check(msg: InboundMessage): GateResult {
    const file = this.access.get();
    const policy = msg.is_group_chat ? file.policies.group_chat : file.policies.dm;

    const chat = file.chats[String(msg.peer_id)];
    if (!chat) {
      if (policy === "pairing") return { kind: "need_pair" };
      return msg.is_group_chat
        ? { kind: "drop", reason: "chat-not-allowed" }
        : { kind: "deny_with_reply", reason: "chat-not-allowed" };
    }

    if (chat.senders.length > 0 && !chat.senders.includes(msg.from_id)) {
      if (policy === "pairing") return { kind: "need_pair" };
      return msg.is_group_chat
        ? { kind: "drop", reason: "sender-not-allowed" }
        : { kind: "deny_with_reply", reason: "sender-not-allowed" };
    }

    if (msg.is_group_chat) {
      const mentionPolicy = chat.mention_policy ?? "mention_only";
      if (mentionPolicy === "mention_only" && !msg.mentioned_bot) {
        return { kind: "drop", reason: "no-mention" };
      }
      if (mentionPolicy === "reply_only" && !msg.is_reply_to_bot) {
        return { kind: "drop", reason: "no-reply-to-bot" };
      }
      // mention_policy === "all": fall through.
    }

    return { kind: "allow" };
  }
}
