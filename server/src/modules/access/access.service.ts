import { singleton } from "tsyringe";
import { BadRequestError, NotFoundError } from "@/common/errors";
import { isGroupChat } from "@/common/utils/peer";
import { UsersCache } from "@/modules/users/users.cache";
import type { ChatEntry, ChatKind, DmPolicy, MentionPolicy, PendingPair } from "./access.schema";
import { AccessStore } from "./access.store";
import { PairingService } from "./pairing";

export interface ChatSummary {
  peer_id: number;
  kind: ChatKind;
  title: string | null;
  sender_count: number;
  added_at: string;
  added_by: "pairing" | "manual";
}

export interface AddGroupInput {
  peer_id: number;
  title?: string;
  allow?: number[];
  mention_policy?: MentionPolicy;
}

/**
 * Application-level access operations consumed by the HTTP controller and
 * skills. Errors propagate as typed {@link HttpError} subclasses so the
 * Elysia-level error handler can map them uniformly — controllers don't
 * branch on outcomes themselves.
 */
@singleton()
export class AccessService {
  constructor(
    private readonly store: AccessStore,
    private readonly pairing: PairingService,
    private readonly users: UsersCache,
  ) {}

  /** All allowed chats reduced to display summaries. */
  listChats(): ChatSummary[] {
    const file = this.store.get();
    return Object.entries(file.chats).map(([peer_id, chat]) => ({
      peer_id: Number(peer_id),
      kind: chat.kind,
      title: chat.title ?? null,
      sender_count: chat.senders.length,
      added_at: chat.added_at,
      added_by: chat.added_by,
    }));
  }

  /** Full chat entry for one peer. Throws {@link NotFoundError} if not allowed. */
  getChat(peerId: string) {
    const chat = this.requireChat(peerId);
    return { peer_id: Number(peerId), ...chat };
  }

  /** Remove a chat entirely. Throws {@link NotFoundError} if not allowed. */
  async removeChat(peerId: string) {
    this.requireChat(peerId);
    await this.store.update((draft) => {
      delete draft.chats[peerId];
    });
    return { peer_id: Number(peerId) };
  }

  /** Sender ids for one chat. Throws {@link NotFoundError} if not allowed. */
  listSenders(peerId: string) {
    const chat = this.requireChat(peerId);
    return { peer_id: Number(peerId), senders: chat.senders.slice() };
  }

  /**
   * Add a sender by `user_id` or `screen_name`. Idempotent.
   * Throws {@link NotFoundError} if the chat isn't allowed,
   * {@link BadRequestError} if the user can't be resolved.
   */
  async addSender(peerId: string, input: { user_id?: number; screen_name?: string }) {
    this.requireChat(peerId);
    let userId: number | null = input.user_id ?? null;
    if (!userId && input.screen_name) {
      userId = await this.users.resolveScreenName(input.screen_name);
    }
    if (!userId) throw new BadRequestError("user-not-found");
    const id = userId;
    await this.store.update((draft) => {
      const chat = draft.chats[peerId]!;
      if (!chat.senders.includes(id)) chat.senders.push(id);
    });
    return { peer_id: Number(peerId), user_id: id };
  }

  /**
   * Drop a sender from a chat's allowlist. Throws {@link NotFoundError} if
   * the chat is unknown or the sender wasn't listed.
   */
  async removeSender(peerId: string, userIdStr: string): Promise<void> {
    const userId = Number(userIdStr);
    const chat = this.requireChat(peerId);
    if (!chat.senders.includes(userId)) throw new NotFoundError("sender-not-listed");
    await this.store.update((draft) => {
      const c = draft.chats[peerId]!;
      c.senders = c.senders.filter((s) => s !== userId);
    });
  }

  /** Explicit group-chat registration. Idempotent. Throws {@link BadRequestError} if `peer_id` is not a group-chat id. */
  async addGroup(input: AddGroupInput) {
    if (!isGroupChat(input.peer_id)) {
      throw new BadRequestError("not-a-group-chat-peer-id");
    }
    const key = String(input.peer_id);
    const now = new Date().toISOString();
    const entry: ChatEntry = {
      kind: "group_chat",
      senders: input.allow ? Array.from(new Set(input.allow)) : [],
      mention_policy: input.mention_policy ?? "mention_only",
      added_at: now,
      added_by: "manual",
      ...(input.title ? { title: input.title } : {}),
    };
    await this.store.update((draft) => {
      draft.chats[key] = entry;
    });
    return { peer_id: input.peer_id, chat: entry };
  }

  private requireChat(peerId: string): ChatEntry {
    const chat = this.store.get().chats[peerId];
    if (!chat) throw new NotFoundError("chat-not-allowed");
    return chat;
  }

  /** Read the DM policy. */
  getPolicies(): { dm: DmPolicy } {
    return { dm: this.store.get().policy };
  }

  /** Set the DM policy. */
  async setDmPolicy(policy: DmPolicy) {
    await this.store.update((draft) => {
      draft.policy = policy;
    });
    return { dm: policy };
  }

  /**
   * Set the mention activation policy for a group chat. Throws
   * {@link NotFoundError} if the chat is unknown, {@link BadRequestError}
   * if the chat is a DM (mention policy is group-only).
   */
  async setMentionPolicy(peerId: string, policy: MentionPolicy) {
    const chat = this.requireChat(peerId);
    if (chat.kind !== "group_chat") {
      throw new BadRequestError("mention-policy-group-only");
    }
    await this.store.update((draft) => {
      draft.chats[peerId]!.mention_policy = policy;
    });
    return { peer_id: Number(peerId), policy };
  }

  /**
   * Consume a pairing code. Throws {@link BadRequestError} on
   * `unknown` / `expired` codes.
   */
  async consumePairing(code: string) {
    const result = await this.pairing.consume(code);
    if (!result.ok) throw new BadRequestError(result.reason);
    return { peer_id: result.peer_id, chat: result.chat };
  }

  /** Outstanding pairing codes (peer + expiry), for `/vk:status`. */
  listPending(): { code: string; pair: PendingPair }[] {
    return this.pairing.listPending();
  }
}
