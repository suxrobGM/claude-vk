import { injectable } from "tsyringe";
import type { InboundMessage } from "@/modules/inbound";
import { AccessStore } from "./access.store";

export type GateResult =
  | { kind: "allow" }
  | { kind: "need_pair" }
  | { kind: "drop"; reason: string };

/**
 * Two-layer gate from PRD §9.4: chat allowlist + per-chat sender allowlist,
 * with a third `mention_policy` layer reserved for M4. DM-only in this PR;
 * group-chat messages currently can't reach the gate because the long-poll
 * router doesn't normalize them yet, but the code paths are symmetric so
 * M4 only has to flip `is_group_chat` and add mention detection.
 *
 * Returns `need_pair` instead of `drop` only under the `pairing` policy —
 * that signal tells the inbound service to emit a pairing-code DM. Under
 * `allowlist`, unknowns are dropped silently.
 */
@injectable()
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

    // mention_policy gate (group chat only) lands in M4.
    return { kind: "allow" };
  }
}
