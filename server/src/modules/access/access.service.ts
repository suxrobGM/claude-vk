import { singleton } from "tsyringe";
import { BadRequestError, NotFoundError } from "@/common/errors";
import { isGroupChat } from "@/common/utils/peer";
import { UsersCache } from "@/modules/users/users.cache";
import { AccessStore } from "./access.store";
import { PairingService } from "./pairing";
import { PendingGroupsRegistry } from "./pending-groups";
import type { ChatEntry, GroupChatEntry, PendingPair } from "./schemas/access-file.schema";
import type { ChatKind, DmPolicy, MentionPolicy } from "./schemas/policy.schema";

export interface ChatSummary {
  peerId: number;
  kind: ChatKind;
  title: string | null;
  senderCount: number;
  addedAt: string;
  addedBy: "pairing" | "manual";
}

export interface AddGroupInput {
  peerId: number;
  title?: string;
  allow?: number[];
  mentionPolicy?: MentionPolicy;
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
    private readonly pendingGroups: PendingGroupsRegistry,
  ) {}

  /** All allowed chats reduced to display summaries. DMs report `senderCount: 1` (the implicit DM peer). */
  listChats(): ChatSummary[] {
    const file = this.store.get();
    return Object.entries(file.chats).map(([peerId, chat]) => ({
      peerId: Number(peerId),
      kind: chat.kind,
      title: chat.title ?? null,
      senderCount: chat.kind === "group_chat" ? chat.senders.length : 1,
      addedAt: chat.addedAt,
      addedBy: chat.addedBy,
    }));
  }

  /** Full chat entry for one peer. Throws {@link NotFoundError} if not allowed. */
  getChat(peerId: string) {
    const chat = this.requireChat(peerId);
    return { peerId: Number(peerId), ...chat };
  }

  /** Remove a chat entirely. Throws {@link NotFoundError} if not allowed. */
  async removeChat(peerId: string) {
    this.requireChat(peerId);
    await this.store.update((draft) => {
      delete draft.chats[peerId];
    });
    return { peerId: Number(peerId) };
  }

  /** Sender ids for one group chat. Throws {@link NotFoundError} if unknown, {@link BadRequestError} for DMs (single implicit sender). */
  listSenders(peerId: string) {
    const chat = this.requireGroupChat(peerId);
    return { peerId: Number(peerId), senders: chat.senders.slice() };
  }

  /**
   * Add a sender by `userId` or `screenName` to a group chat. Idempotent.
   * Throws {@link NotFoundError} if the chat isn't allowed,
   * {@link BadRequestError} if the user can't be resolved or the chat is a DM.
   */
  async addSender(peerId: string, input: { userId?: number; screenName?: string }) {
    this.requireGroupChat(peerId);
    let userId: number | null = input.userId ?? null;

    if (!userId && input.screenName) {
      userId = await this.users.resolveScreenName(input.screenName);
    }
    if (!userId) {
      throw new BadRequestError("user-not-found");
    }
    const id = userId;

    await this.store.update((draft) => {
      const chat = draft.chats[peerId];
      if (chat?.kind !== "group_chat") {
        return;
      }
      if (!chat.senders.includes(id)) {
        chat.senders.push(id);
      }
    });
    return { peerId: Number(peerId), userId: id };
  }

  /**
   * Drop a sender from a group chat's allowlist. Throws {@link NotFoundError}
   * if the chat is unknown or the sender wasn't listed,
   * {@link BadRequestError} if the chat is a DM.
   */
  async removeSender(peerId: string, userIdStr: string): Promise<void> {
    const userId = Number(userIdStr);
    const chat = this.requireGroupChat(peerId);

    if (!chat.senders.includes(userId)) {
      throw new NotFoundError("sender-not-listed");
    }

    await this.store.update((draft) => {
      const c = draft.chats[peerId];
      if (c?.kind !== "group_chat") {
        return;
      }
      c.senders = c.senders.filter((s) => s !== userId);
    });
  }

  /** Explicit group-chat registration. Idempotent. Throws {@link BadRequestError} if `peerId` is not a group-chat id. */
  async addGroup(input: AddGroupInput) {
    if (!isGroupChat(input.peerId)) {
      throw new BadRequestError("not-a-group-chat-peer-id");
    }

    const key = String(input.peerId);
    const now = new Date().toISOString();

    const entry: ChatEntry = {
      kind: "group_chat",
      senders: input.allow ? Array.from(new Set(input.allow)) : [],
      mentionPolicy: input.mentionPolicy ?? "mention_only",
      addedAt: now,
      addedBy: "manual",
      ...(input.title ? { title: input.title } : {}),
    };

    await this.store.update((draft) => {
      draft.chats[key] = entry;
    });
    this.pendingGroups.forget(input.peerId);
    return { peerId: input.peerId, chat: entry };
  }

  /** Group-chat peerIds the inbound gate dropped recently — operator hint. */
  listPendingGroups() {
    return this.pendingGroups.list();
  }

  private requireChat(peerId: string): ChatEntry {
    const chat = this.store.get().chats[peerId];
    if (!chat) {
      throw new NotFoundError("chat-not-allowed");
    }
    return chat;
  }

  private requireGroupChat(peerId: string): GroupChatEntry {
    const chat = this.requireChat(peerId);
    if (chat.kind !== "group_chat") {
      throw new BadRequestError("senders-group-only");
    }
    return chat;
  }

  /** Read the DM policy. */
  getPolicies(): { dm: DmPolicy } {
    return { dm: this.store.get().dmPolicy };
  }

  /** Set the DM policy. */
  async setDmPolicy(policy: DmPolicy) {
    await this.store.update((draft) => {
      draft.dmPolicy = policy;
    });
    return { dm: policy };
  }

  /**
   * Set the mention activation policy for a group chat. Throws
   * {@link NotFoundError} if the chat is unknown, {@link BadRequestError}
   * if the chat is a DM (mention policy is group-only).
   */
  async setMentionPolicy(peerId: string, policy: MentionPolicy) {
    this.requireGroupChat(peerId);

    await this.store.update((draft) => {
      const chat = draft.chats[peerId];
      if (chat?.kind !== "group_chat") {
        return;
      }
      chat.mentionPolicy = policy;
    });
    return { peerId: Number(peerId), policy };
  }

  /**
   * Consume a pairing code. Throws {@link BadRequestError} on
   * `unknown` / `expired` codes.
   */
  async consumePairing(code: string) {
    const result = await this.pairing.consume(code);
    if (!result.ok) throw new BadRequestError(result.reason);
    return { peerId: result.peerId, chat: result.chat };
  }

  /** Outstanding pairing codes (peer + expiry), for `/vk:status`. */
  listPending(): { code: string; pair: PendingPair }[] {
    return this.pairing.listPending();
  }
}
