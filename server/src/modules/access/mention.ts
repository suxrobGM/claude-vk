import { singleton } from "tsyringe";
import type { InboundMessage } from "@/modules/inbound/inbound.types";
import { RecentSentMessages } from "@/modules/messaging/recent-sent";
import { CommunityResolver } from "./community-resolver";

/**
 * Per-message attention signals derived from raw text + reply state. The
 * mention-policy gate consumes the booleans; the inbound service ORs them
 * into `InboundMessage.mentioned_bot`.
 */
export interface MentionSignals {
  /** Text contains `[club{ID}|...]` (canonical VK form) or `@<screen_name>`. */
  name_mention: boolean;
  /** `reply_to` matches a cmid the bot sent to this peer recently. */
  reply_to_bot: boolean;
  /**
   * Keyboard-callback payload. Always `false` in M4 — `InboundMessage` does
   * not carry `payload` yet (keyboards are a v2 stretch per PRD §19). Wired
   * now so detection has the right shape and M7 only flips this flag.
   */
  keyboard_payload: boolean;
}

const CLUB_MENTION_RE = /\[club(\d+)\|[^\]]*\]/;
const SCREEN_NAME_RE = /@([a-zA-Z0-9_.]+)/g;

/**
 * Mention detection for group chats. The community ID and screen name come
 * from `config.current()` at call time (not constructor capture) so an .env
 * hot-reload picks up renames without restart.
 */
@singleton()
export class MentionDetector {
  constructor(
    private readonly recent: RecentSentMessages,
    private readonly community: CommunityResolver,
  ) {}

  detect(msg: InboundMessage): MentionSignals {
    const identity = this.community.get();
    const communityId = identity?.id;
    const screenName = identity?.screen_name?.toLowerCase();

    return {
      name_mention: this.hasNameMention(msg.text, communityId, screenName),
      reply_to_bot: this.isReplyToBot(msg.peer_id, msg.reply_to),
      keyboard_payload: false,
    };
  }

  private hasNameMention(
    text: string,
    communityId: string | undefined,
    screenName: string | undefined,
  ): boolean {
    if (!text) return false;

    const clubMatch = text.match(CLUB_MENTION_RE);
    if (clubMatch && communityId && clubMatch[1] === communityId) {
      return true;
    }

    if (screenName) {
      SCREEN_NAME_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = SCREEN_NAME_RE.exec(text)) !== null) {
        if (m[1]!.toLowerCase() === screenName) return true;
      }
    }

    return false;
  }

  private isReplyToBot(peerId: number, replyToCmid: number | undefined): boolean {
    if (replyToCmid == null) return false;
    for (const entry of this.recent.all()) {
      if (entry.peer_id === peerId && entry.conversation_message_id === replyToCmid) {
        return true;
      }
    }
    return false;
  }
}
