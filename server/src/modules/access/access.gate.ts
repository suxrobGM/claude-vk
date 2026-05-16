import { singleton } from "tsyringe";
import type { InboundMessage } from "@/modules/inbound/inbound.types";
import { AccessStore } from "./access.store";

export type GateResult =
  | { kind: "allow" }
  | { kind: "need_pair" }
  | { kind: "deny_with_reply"; reason: string }
  | { kind: "drop"; reason: string };

/** Gate: chat allowlist → (group only) sender allowlist + mention activation. DMs have one implicit sender. */
@singleton()
export class AccessGate {
  constructor(private readonly access: AccessStore) {}

  check(msg: InboundMessage): GateResult {
    const file = this.access.get();

    // `disabled` is a global kill switch — drops every inbound message, DM and group, even allowlisted ones.
    if (file.dm_policy === "disabled") {
      return { kind: "drop", reason: "disabled" };
    }

    const chat = file.chats[String(msg.peer_id)];
    if (!chat) {
      if (msg.is_group_chat) {
        return { kind: "drop", reason: "chat-not-allowed" };
      }

      return file.dm_policy === "pairing"
        ? { kind: "need_pair" }
        : { kind: "deny_with_reply", reason: "chat-not-allowed" };
    }

    if (chat.kind === "group_chat") {
      if (chat.senders.length > 0 && !chat.senders.includes(msg.from_id)) {
        return { kind: "drop", reason: "sender-not-allowed" };
      }

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
