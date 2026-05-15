import "reflect-metadata";
import { describe, expect, it } from "bun:test";
import { PluginError, VkApiError } from "@/common/errors";
import type {
  ApiContract,
  DeleteMessageParams,
  EditMessageParams,
  SendMessageParams,
  SendMessageResponse,
} from "@/vk/client";
import { MessagingService } from "./messaging.service";

class FakeApiContract implements ApiContract {
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
}

function makeService(vk: ApiContract): MessagingService {
  // Bypass DI: construct directly with the contract. The service only depends
  // on VkClient's contract methods, so the cast is sound for tests.
  return new MessagingService(vk as never);
}

describe("MessagingService.send", () => {
  it("returns ok with one cmid for short text", async () => {
    const vk = new FakeApiContract();
    const svc = makeService(vk);
    const result = await svc.send({ peer_id: 42, text: "hello" });
    expect(result).toEqual({ ok: true, conversation_message_ids: [1000] });
    expect(vk.sentCalls).toHaveLength(1);
    expect(vk.sentCalls[0]!.message).toBe("hello");
    expect(vk.sentCalls[0]!.peer_id).toBe(42);
  });

  it("auto-chunks text past 4096 chars", async () => {
    const vk = new FakeApiContract();
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
    const vk = new FakeApiContract();
    const svc = makeService(vk);
    const text = "a".repeat(8000);
    await svc.send({ peer_id: 42, text, reply_to: 999 });
    expect(vk.sentCalls[0]!.reply_to).toBe(999);
    for (const c of vk.sentCalls.slice(1)) {
      expect(c.reply_to).toBeUndefined();
    }
  });

  it("returns failure envelope on VkApiError", async () => {
    const vk = new FakeApiContract({
      send: async () => {
        throw new VkApiError(9, "flood control");
      },
    });
    const svc = makeService(vk);
    const result = await svc.send({ peer_id: 42, text: "hi" });
    expect(result).toEqual({
      ok: false,
      code: "vk_api_9",
      message: "flood control",
      vk_error_code: 9,
    });
  });

  it("returns plugin-error envelope on PluginError (e.g. token missing)", async () => {
    const vk = new FakeApiContract({
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
    const vk = new FakeApiContract({
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
});

describe("MessagingService.edit", () => {
  it("forwards to vk.editMessage and returns ok", async () => {
    const vk = new FakeApiContract();
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
    const vk = new FakeApiContract({
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
    const vk = new FakeApiContract();
    const svc = makeService(vk);
    await svc.delete({ peer_id: 42, conversation_message_id: 99, delete_for_all: true });
    expect(vk.deleteCalls).toEqual([
      { peer_id: 42, conversation_message_ids: [99], delete_for_all: 1 },
    ]);
  });

  it("maps delete_for_all=false to 0 in the API call", async () => {
    const vk = new FakeApiContract();
    const svc = makeService(vk);
    await svc.delete({ peer_id: 42, conversation_message_id: 99, delete_for_all: false });
    expect(vk.deleteCalls[0]!.delete_for_all).toBe(0);
  });
});
