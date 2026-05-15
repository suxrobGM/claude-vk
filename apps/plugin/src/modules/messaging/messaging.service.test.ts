import "reflect-metadata";
import { describe, expect, it } from "bun:test";
import { PluginError, VkApiError } from "@/common/errors";
import type { VkApi } from "@/vk/api";
import type {
  DeleteMessageParams,
  DocsSaveParams,
  EditMessageParams,
  GetDocUploadServerParams,
  GetHistoryParams,
  GetHistoryResponse,
  GetPhotoUploadServerParams,
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
} from "@/vk/api.types";
import { MessagingService } from "./messaging.service";
import { RecentSentMessages } from "./recent-sent";

class FakeVkApi implements VkApi {
  sentCalls: SendMessageParams[] = [];
  editCalls: EditMessageParams[] = [];
  deleteCalls: DeleteMessageParams[] = [];

  constructor(
    private readonly behavior: {
      send?: (p: SendMessageParams, idx: number) => Promise<SendMessageResponse>;
      edit?: (p: EditMessageParams) => Promise<number>;
      delete?: (p: DeleteMessageParams) => Promise<Record<string, number>>;
    } = {},
  ) {}

  async sendMessage(p: SendMessageParams): Promise<SendMessageResponse> {
    const idx = this.sentCalls.length;
    this.sentCalls.push(p);
    if (this.behavior.send) return this.behavior.send(p, idx);
    return { conversation_message_id: 1000 + idx, message_id: 1000 + idx };
  }
  async editMessage(p: EditMessageParams): Promise<number> {
    this.editCalls.push(p);
    return this.behavior.edit ? this.behavior.edit(p) : 1;
  }
  async deleteMessage(p: DeleteMessageParams): Promise<Record<string, number>> {
    this.deleteCalls.push(p);
    return this.behavior.delete ? this.behavior.delete(p) : { [String(p.peer_id)]: 1 };
  }
  async usersGet(_p: UsersGetParams): Promise<UsersGetResponseEntry[]> {
    return [];
  }
  async sendReaction(_p: SendReactionParams): Promise<void> {}
  async markAsRead(_p: MarkAsReadParams): Promise<void> {}
  async getHistory(_p: GetHistoryParams): Promise<GetHistoryResponse> {
    return { count: 0, items: [], profiles: [] };
  }
  async searchMessages(_p: SearchMessagesParams): Promise<SearchMessagesResponse> {
    return { count: 0, items: [] };
  }
  async getPhotoUploadServer(_p: GetPhotoUploadServerParams): Promise<UploadServerInfo> {
    return { upload_url: "" };
  }
  async saveMessagesPhoto(_p: SaveMessagesPhotoParams): Promise<SavedAttachmentRef> {
    return { vk_ref: "" };
  }
  async getDocUploadServer(_p: GetDocUploadServerParams): Promise<UploadServerInfo> {
    return { upload_url: "" };
  }
  async saveDoc(_p: DocsSaveParams): Promise<SavedAttachmentRef> {
    return { vk_ref: "" };
  }
  async groupsGetSelf(): Promise<{ id: number; screen_name?: string }> {
    return { id: 1, screen_name: "test" };
  }
}

function makeService(
  vk: VkApi,
  recent: RecentSentMessages = new RecentSentMessages(),
): MessagingService {
  // Bypass DI: construct directly with the contract + the in-memory ring.
  return new MessagingService(vk as never, recent);
}

describe("MessagingService.send", () => {
  it("returns ok with one cmid for short text", async () => {
    const vk = new FakeVkApi();
    const svc = makeService(vk);
    const result = await svc.send({ peer_id: 42, text: "hello" });
    expect(result).toEqual({ ok: true, conversation_message_ids: [1000] });
    expect(vk.sentCalls).toHaveLength(1);
    expect(vk.sentCalls[0]!.message).toBe("hello");
    expect(vk.sentCalls[0]!.peer_id).toBe(42);
  });

  it("auto-chunks text past 4096 chars", async () => {
    const vk = new FakeVkApi();
    const svc = makeService(vk);
    const text = "a".repeat(4097);
    const result = await svc.send({ peer_id: 42, text });
    expect(result.ok).toBe(true);
    expect(vk.sentCalls.length).toBeGreaterThanOrEqual(2);
    expect(vk.sentCalls.every((c) => c.message.length <= 4096)).toBe(true);
    if (result.ok) {
      expect(result.conversation_message_ids).toHaveLength(vk.sentCalls.length);
    }
  });

  it("attaches reply_to only to the first chunk", async () => {
    const vk = new FakeVkApi();
    const svc = makeService(vk);
    const text = "a".repeat(8000);
    await svc.send({ peer_id: 42, text, reply_to: 999 });
    expect(vk.sentCalls[0]!.reply_to).toBe(999);
    for (const c of vk.sentCalls.slice(1)) {
      expect(c.reply_to).toBeUndefined();
    }
  });

  it("returns failure envelope on VkApiError", async () => {
    const vk = new FakeVkApi({
      send: async () => {
        throw new VkApiError(9, "flood control");
      },
    });
    const svc = makeService(vk);
    const result = await svc.send({ peer_id: 42, text: "hi" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("vk_api_9");
    expect(result.vk_error_code).toBe(9);
    expect(result.message).toStartWith("flood control");
    expect(result.message).toContain("flood-control");
  });

  it("returns plugin-error envelope on PluginError (e.g. token missing)", async () => {
    const vk = new FakeVkApi({
      send: async () => {
        throw new PluginError("vk_token_missing", "no token");
      },
    });
    const svc = makeService(vk);
    const result = await svc.send({ peer_id: 42, text: "hi" });
    expect(result).toEqual({
      ok: false,
      code: "vk_token_missing",
      message: "no token",
    });
  });

  it("returns internal_error envelope on unexpected throw", async () => {
    const vk = new FakeVkApi({
      send: async () => {
        throw new TypeError("boom");
      },
    });
    const svc = makeService(vk);
    const result = await svc.send({ peer_id: 42, text: "hi" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("internal_error");
      expect(result.message).toBe("boom");
    }
  });

  it("pushes every outbound cmid into the recent-messages ring", async () => {
    const vk = new FakeVkApi();
    const recent = new RecentSentMessages();
    const svc = makeService(vk, recent);
    const text = "a".repeat(8000);
    await svc.send({ peer_id: 42, text });
    expect(recent.all().length).toBe(vk.sentCalls.length);
    expect(recent.all().every((r) => r.peer_id === 42)).toBe(true);
  });
});

describe("MessagingService.edit", () => {
  it("forwards to vk.editMessage and returns ok", async () => {
    const vk = new FakeVkApi();
    const svc = makeService(vk);
    const result = await svc.edit({
      peer_id: 42,
      conversation_message_id: 99,
      text: "edited",
    });
    expect(result).toEqual({ ok: true });
    expect(vk.editCalls).toEqual([{ peer_id: 42, conversation_message_id: 99, message: "edited" }]);
  });

  it("surfaces VK errors via envelope", async () => {
    const vk = new FakeVkApi({
      edit: async () => {
        throw new VkApiError(909, "cannot edit");
      },
    });
    const svc = makeService(vk);
    const result = await svc.edit({ peer_id: 1, conversation_message_id: 1, text: "x" });
    expect(result).toEqual({
      ok: false,
      code: "vk_api_909",
      message: "cannot edit",
      vk_error_code: 909,
    });
  });
});

describe("MessagingService.delete", () => {
  it("maps delete_for_all=true to 1 in the API call", async () => {
    const vk = new FakeVkApi();
    const svc = makeService(vk);
    await svc.delete({ peer_id: 42, conversation_message_id: 99, delete_for_all: true });
    expect(vk.deleteCalls).toEqual([
      { peer_id: 42, conversation_message_ids: [99], delete_for_all: 1 },
    ]);
  });

  it("maps delete_for_all=false to 0 in the API call", async () => {
    const vk = new FakeVkApi();
    const svc = makeService(vk);
    await svc.delete({ peer_id: 42, conversation_message_id: 99, delete_for_all: false });
    expect(vk.deleteCalls[0]!.delete_for_all).toBe(0);
  });
});
