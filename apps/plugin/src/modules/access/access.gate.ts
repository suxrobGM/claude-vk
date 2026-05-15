import { singleton } from "tsyringe";
import type { InboundMessage } from "@/modules/inbound";
import { AccessStore } from "./access.store";

export type GateResult =
  | { kind: "allow" }
  | { kind: "need_pair" }
  | { kind: "drop"; reason: string };

/**
 * PRD §9.4 three-layer gate: chat allowlist → per-chat sender allowlist →
 * mention-policy activation (group chats only). Mention-policy is a *quiet*
 * filter — applied after sender check, so a non-mention from a known sender
 * is a silent drop, not a `need_pair`.
 */
@singleton()
export class AccessGate {
  constructor(private readonly access: AccessStore) {}

  check(msg: InboundMessage): GateResult {
    const file = this.access.get();
    const policy = msg.is_group_chat ? file.policies.group_chat : file.policies.dm;

    if (policy === "open") {
      // 'open' is rejected for group_chat by the schema, so this only fires for DM.
      return { kind: "allow" };
    }

    const chat = file.chats[String(msg.peer_id)];
    if (!chat) {
      return policy === "pairing"
        ? { kind: "need_pair" }
        : { kind: "drop", reason: "chat-not-allowed" };
    }

    if (!chat.senders.includes(msg.from_id)) {
      return policy === "pairing"
        ? { kind: "need_pair" }
        : { kind: "drop", reason: "sender-not-allowed" };
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
