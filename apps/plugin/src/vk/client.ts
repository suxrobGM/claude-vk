import { singleton } from "tsyringe";
import { VK } from "vk-io";
import { PluginError } from "@/common/errors";
import { current } from "@/config";
import { RateLimiter } from "./rate-limiter";

const VK_API_VERSION = "5.199";

export interface SendMessageParams {
  peer_id: number;
  message: string;
  reply_to?: number;
  random_id: number;
}

export interface EditMessageParams {
  peer_id: number;
  conversation_message_id: number;
  message: string;
}

export interface DeleteMessageParams {
  peer_id: number;
  conversation_message_ids: number[];
  delete_for_all: 0 | 1;
}

export interface UsersGetParams {
  user_ids: string; // comma-separated ids or screen names; VK accepts either
  fields?: string;
}

export interface UsersGetResponseEntry {
  id: number;
  first_name?: string;
  last_name?: string;
  screen_name?: string;
  photo_100?: string;
  deactivated?: string;
}

export interface SendMessageResponse {
  conversation_message_id: number;
  message_id: number;
}

/**
 * Narrow contract messaging tools depend on. Tests pass a plain-object impl —
 * the real implementation lives on `VkClient` below and routes through vk-io.
 */
export interface ApiContract {
  sendMessage(p: SendMessageParams): Promise<SendMessageResponse>;
  editMessage(p: EditMessageParams): Promise<number>;
  deleteMessage(p: DeleteMessageParams): Promise<Record<string, number>>;
  usersGet(p: UsersGetParams): Promise<UsersGetResponseEntry[]>;
}

/**
 * Singleton VK API client. Lazily constructs the underlying vk-io instance on
 * the first method call so the process can boot without `VK_TOKEN` set —
 * `/healthz` and `/readyz` stay reachable during initial setup. Tools that
 * require VK surface `vk_token_missing` as a structured error envelope at
 * call time.
 *
 * Every API method is wrapped through `RateLimiter.withRetry` so the 20 req/s
 * group quota and the VK error 6 / error 9 policy apply uniformly.
 */
@singleton()
export class VkClient implements ApiContract {
  private vk: VK | null = null;

  constructor(private readonly limiter: RateLimiter) {}

  sendMessage(p: SendMessageParams): Promise<SendMessageResponse> {
    return this.limiter.withRetry(async () => {
      const vk = this.getVk();
      const res = await vk.api.messages.send({
        peer_id: p.peer_id,
        message: p.message,
        random_id: p.random_id,
        reply_to: p.reply_to,
      });
      return normalizeSendResponse(res);
    });
  }

  editMessage(p: EditMessageParams): Promise<number> {
    return this.limiter.withRetry(async () => {
      const vk = this.getVk();
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
    return this.limiter.withRetry(async () => {
      const vk = this.getVk();
      const res = await vk.api.messages.delete({
        peer_id: p.peer_id,
        cmids: p.conversation_message_ids,
        delete_for_all: p.delete_for_all === 1,
      });
      return res as unknown as Record<string, number>;
    });
  }

  usersGet(p: UsersGetParams): Promise<UsersGetResponseEntry[]> {
    return this.limiter.withRetry(async () => {
      const vk = this.getVk();
      const res = await vk.api.users.get({
        user_ids: p.user_ids.split(",").map((s) => s.trim()),
        fields: (p.fields ? p.fields.split(",").map((s) => s.trim()) : undefined) as never,
      });
      return res as unknown as UsersGetResponseEntry[];
    });
  }

  /** Test/hot-reload helper: drop the cached vk-io instance. */
  reset(): void {
    this.vk = null;
  }

  private getVk(): VK {
    if (this.vk) return this.vk;
    const token = current().vkToken;
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

/**
 * vk-io's `messages.send` returns either a numeric message id (single-peer
 * call) or an array of per-peer results when `peer_ids` is used. M1 only ever
 * uses the single-peer form, but we need to coerce both shapes into our
 * `conversation_message_id` contract. When VK returns the bare numeric id we
 * mirror it as the cmid since callers only ever index by cmid downstream.
 */
function normalizeSendResponse(res: unknown): SendMessageResponse {
  if (typeof res === "number") {
    return { conversation_message_id: res, message_id: res };
  }
  if (typeof res === "object" && res !== null) {
    const obj = res as Record<string, unknown>;
    const cmid = Number(obj.conversation_message_id ?? obj.message_id);
    const mid = Number(obj.message_id ?? obj.conversation_message_id);
    if (Number.isFinite(cmid) && Number.isFinite(mid)) {
      return { conversation_message_id: cmid, message_id: mid };
    }
  }
  throw new Error(`Unexpected messages.send response shape: ${JSON.stringify(res)}`);
}
