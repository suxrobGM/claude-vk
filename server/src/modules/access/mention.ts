import { singleton } from "tsyringe";
import { logger } from "@/common/logger";
import type { InboundMessage } from "@/modules/inbound/inbound.types";
import { RecentSentMessages } from "@/modules/messaging/recent-sent";
import { AccessStore } from "./access.store";
import { CommunityResolver } from "./community-resolver";

/**
 * Per-message attention signals derived from raw text + reply state. The
 * mention-policy gate consumes the booleans; the inbound service ORs them
 * into `InboundMessage.mentioned_bot`.
 */
export interface MentionSignals {
  /** Text contains `[club{ID}|...]`, `@<screen_name>`, or one of `access.json:mentionPatterns`. */
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

// The mention patterns are simple substrings rather than regexes
const REGEX_META_RE = /[.*+?^${}()|[\]\\]/g;

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
    private readonly access: AccessStore,
  ) {}

  detect(msg: InboundMessage): MentionSignals {
    const identity = this.community.get();
    const communityId = identity?.id;
    const screenName = identity?.screenName?.toLowerCase();
    const patterns = this.access.get().mentionPatterns;

    const signals: MentionSignals = {
      name_mention: this.hasNameMention(msg.text, communityId, screenName, patterns),
      reply_to_bot: this.isReplyToBot(msg.peer_id, msg.reply_to, msg.reply_to_from_id, communityId),
      keyboard_payload: false,
    };

    logger.debug(
      {
        peer_id: msg.peer_id,
        text: msg.text,
        community_id: communityId,
        screen_name: screenName,
        identity_resolved: identity !== null,
        name_mention: signals.name_mention,
        reply_to_bot: signals.reply_to_bot,
      },
      "mention detect",
    );

    return signals;
  }

  private hasNameMention(
    text: string,
    communityId: string | undefined,
    screenName: string | undefined,
    patterns: readonly string[],
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

    for (const pattern of patterns) {
      if (!pattern) {
        continue;
      }

      // Explicit (?:^|\W) / (?=\W|$) boundaries — \b is unreliable for Cyrillic.
      const re = new RegExp(`(?:^|\\W)${escapeRegex(pattern)}(?=\\W|$)`, "i");
      if (re.test(text)) {
        return true;
      }
    }

    return false;
  }

  private isReplyToBot(
    peerId: number,
    replyToCmid?: number,
    replyToFromId?: number,
    communityId?: string,
  ): boolean {
    if (replyToCmid == null) {
      return false;
    }

    // Survives restart: VK gives us the quoted message's from_id, and the bot
    // always posts as the community (negative of communityId).
    if (replyToFromId != null && communityId && replyToFromId === -Number(communityId)) {
      return true;
    }

    for (const entry of this.recent.all()) {
      if (entry.peer_id === peerId && entry.conversation_message_id === replyToCmid) {
        return true;
      }
    }
    return false;
  }
}

function escapeRegex(s: string): string {
  return s.replace(REGEX_META_RE, "\\$&");
}
