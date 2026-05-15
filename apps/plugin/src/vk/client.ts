import { singleton } from "tsyringe";
import { VK } from "vk-io";
import { PluginError, VkApiError } from "@/common/errors";
import type { VkApi } from "./api";
import type {
  DeleteMessageParams,
  DocsSaveParams,
  EditMessageParams,
  GetDocUploadServerParams,
  GetHistoryParams,
  GetHistoryResponse,
  GetPhotoUploadServerParams,
  GroupsGetByIdResponseEntry,
  MarkAsReadParams,
  SavedAttachmentRef,
  SaveMessagesPhotoParams,
  SearchMessagesParams,
  SearchMessagesResponse,
  SendMessageParams,
  SendMessageResponse,
  SendReactionParams,
  UploadServerInfo,
  UsersGetParams,
  UsersGetResponseEntry,
} from "./api.types";
import { toHistoryMessage, toSendResponse } from "./mappers";
import { RateLimiter } from "./rate-limiter";

const VK_API_VERSION = "5.199";

/**
 * Singleton VK API client. Lazily constructs vk-io on first call so the
 * process boots without `VK_TOKEN` set — `/healthz` stays reachable and tools
 * surface `vk_token_missing` as a structured envelope. Every method goes
 * through `RateLimiter.withRetry`.
 */
@singleton()
export class VkClient implements VkApi {
  private vk: VK | null = null;

  constructor(private readonly limiter: RateLimiter) {}

  sendMessage(p: SendMessageParams): Promise<SendMessageResponse> {
    return this.run((vk) =>
      vk.api.messages
        .send({
          peer_id: p.peer_id,
          message: p.message,
          random_id: p.random_id,
          reply_to: p.reply_to,
        })
        .then(toSendResponse),
    );
  }

  editMessage(p: EditMessageParams): Promise<number> {
    return this.run(async (vk) => {
      const res = await vk.api.messages.edit({
        peer_id: p.peer_id,
        conversation_message_id: p.conversation_message_id,
        message: p.message,
        keep_forward_messages: true,
        keep_snippets: true,
      });
      return Number(res);
    });
  }

  deleteMessage(p: DeleteMessageParams): Promise<Record<string, number>> {
    return this.run(async (vk) => {
      const res = await vk.api.messages.delete({
        peer_id: p.peer_id,
        cmids: p.conversation_message_ids,
        delete_for_all: p.delete_for_all === 1,
      });
      return res as unknown as Record<string, number>;
    });
  }

  usersGet(p: UsersGetParams): Promise<UsersGetResponseEntry[]> {
    return this.run(async (vk) => {
      const res = await vk.api.users.get({
        user_ids: p.user_ids.split(",").map((s) => s.trim()),
        fields: (p.fields ? p.fields.split(",").map((s) => s.trim()) : undefined) as never,
      });
      return res as unknown as UsersGetResponseEntry[];
    });
  }

  sendReaction(p: SendReactionParams): Promise<void> {
    return this.run(async (vk) => {
      await vk.api.messages.sendReaction({
        peer_id: p.peer_id,
        cmid: p.cmid,
        reaction_id: p.reaction_id,
      });
    });
  }

  markAsRead(p: MarkAsReadParams): Promise<void> {
    return this.run(async (vk) => {
      await vk.api.messages.markAsRead({
        peer_id: p.peer_id,
        start_message_id: p.start_message_id,
      });
    });
  }

  getHistory(p: GetHistoryParams): Promise<GetHistoryResponse> {
    return this.run(async (vk) => {
      const res = (await vk.api.messages.getHistory({
        peer_id: p.peer_id,
        count: p.count,
        offset: p.offset,
        start_message_id: p.start_message_id,
        extended: p.extended,
      } as never)) as unknown as {
        count: number;
        items: unknown[];
        profiles?: UsersGetResponseEntry[];
      };
      return {
        count: res.count,
        items: res.items.map(toHistoryMessage),
        profiles: res.profiles ?? [],
      };
    });
  }

  searchMessages(p: SearchMessagesParams): Promise<SearchMessagesResponse> {
    return this.run(async (vk) => {
      const res = (await vk.api.messages.search({
        q: p.q,
        peer_id: p.peer_id,
        count: p.count,
        offset: p.offset,
      } as never)) as unknown as { count: number; items: unknown[] };
      return { count: res.count, items: res.items.map(toHistoryMessage) };
    });
  }

  getPhotoUploadServer(p: GetPhotoUploadServerParams): Promise<UploadServerInfo> {
    return this.run(async (vk) => {
      const res = await vk.api.photos.getMessagesUploadServer({ peer_id: p.peer_id });
      return { upload_url: (res as { upload_url: string }).upload_url };
    });
  }

  saveMessagesPhoto(p: SaveMessagesPhotoParams): Promise<SavedAttachmentRef> {
    return this.run(async (vk) => {
      const res = await vk.api.photos.saveMessagesPhoto({
        photo: p.photo,
        server: p.server,
        hash: p.hash,
      });
      const item = (res as Array<{ owner_id: number; id: number }>)[0];
      if (!item) throw new VkApiError(0, "photos.saveMessagesPhoto returned empty array");
      return { vk_ref: `photo${item.owner_id}_${item.id}` };
    });
  }

  getDocUploadServer(p: GetDocUploadServerParams): Promise<UploadServerInfo> {
    return this.run(async (vk) => {
      const res = await vk.api.docs.getMessagesUploadServer({
        peer_id: p.peer_id,
        type: p.type,
      });
      return { upload_url: (res as { upload_url: string }).upload_url };
    });
  }

  saveDoc(p: DocsSaveParams): Promise<SavedAttachmentRef> {
    return this.run(async (vk) => {
      const res = await vk.api.docs.save({ file: p.file, title: p.title });
      const item = res as {
        doc?: { owner_id: number; id: number };
        audio_message?: { owner_id: number; id: number };
      };
      const doc = item.doc ?? item.audio_message;
      if (!doc) throw new VkApiError(0, "docs.save returned no doc payload");
      return { vk_ref: `doc${doc.owner_id}_${doc.id}` };
    });
  }

  groupsGetSelf(): Promise<GroupsGetByIdResponseEntry> {
    return this.run(async (vk) => {
      const raw = await vk.api.groups.getById({});
      const first = raw.groups[0];
      if (!first) {
        throw new VkApiError(0, "groups.getById returned empty result");
      }
      return first;
    });
  }

  /** Wrap one vk-io call with the shared rate-limit-plus-retry policy. */
  private run<T>(fn: (vk: VK) => Promise<T>): Promise<T> {
    return this.limiter.withRetry(() => fn(this.getVk()));
  }

  private getVk(): VK {
    if (this.vk) return this.vk;
    const token = process.env.VK_TOKEN;
    if (!token) {
      throw new PluginError(
        "vk_token_missing",
        "VK_TOKEN is not set in ~/.claude/channels/vk/.env",
      );
    }
    this.vk = new VK({ token, apiVersion: VK_API_VERSION });
    return this.vk;
  }
}
