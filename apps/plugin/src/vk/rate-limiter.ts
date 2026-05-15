import { singleton } from "tsyringe";
import { APIError } from "vk-io";
import { VkApiError } from "@/common/errors";

const VK_GROUP_REQ_PER_SEC = 20;
const VK_ERROR_TOO_MANY_REQUESTS = 6;
const VK_ERROR_FLOOD_CONTROL = 9;
const RETRY_BASE_MS = 250;
const RETRY_MAX_ATTEMPTS = 5;
const MIN_SLEEP_MS = 1;

export interface RateLimiterOptions {
  capacity?: number;
  refillPerSec?: number;
  /** Injectable clock for tests; defaults to `Date.now`. */
  now?: () => number;
  /** Injectable sleep for tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Token-bucket rate limiter wrapped around vk-io API calls. One bucket per
 * process — VK's 20 req/s quota is per community token, not per method.
 *
 * Design choice: instead of a queue + setTimeout-based waker, each blocked
 * `acquire` polls in a sleep loop. This trades strict FIFO for two properties
 * that matter more in this codebase: zero leaked timers (so `bun test` always
 * exits cleanly) and a trivially testable code path. Wake order is still
 * approximately FIFO because earlier callers compute shorter sleeps.
 *
 * `withRetry` additionally swallows VK transient errors:
 *   - error 6 ("too many requests") retries up to 5× with `250 * attempt` ms backoff.
 *   - error 9 (flood control) is fatal — surfaces immediately.
 *   - any other vk-io `APIError` is rethrown as `VkApiError`.
 */
@singleton()
export class RateLimiter {
  private readonly capacity: number;
  private readonly refillPerSec: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private tokens: number;
  private lastRefillAt: number;

  constructor(opts: RateLimiterOptions = {}) {
    this.capacity = opts.capacity ?? VK_GROUP_REQ_PER_SEC;
    this.refillPerSec = opts.refillPerSec ?? VK_GROUP_REQ_PER_SEC;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? defaultSleep;
    this.tokens = this.capacity;
    this.lastRefillAt = this.now();
  }

  /** Acquires a token, blocking (asynchronously) until one is available. */
  async acquire(): Promise<void> {
    for (;;) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const deficit = 1 - this.tokens;
      const msUntilNext = Math.max(MIN_SLEEP_MS, Math.ceil((deficit * 1000) / this.refillPerSec));
      await this.sleep(msUntilNext);
    }
  }

  /**
   * Wraps `fn` with `acquire()` and the VK retry policy described on the class.
   * `fn` is expected to call vk-io directly; thrown vk-io errors are translated
   * into `VkApiError` for downstream consumers.
   */
  async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let attempt = 0;
    for (;;) {
      attempt += 1;
      await this.acquire();
      try {
        return await fn();
      } catch (err) {
        const code = extractApiErrorCode(err);
        if (code === VK_ERROR_TOO_MANY_REQUESTS && attempt < RETRY_MAX_ATTEMPTS) {
          await this.sleep(RETRY_BASE_MS * attempt);
          continue;
        }
        if (code !== undefined) {
          throw new VkApiError(code, (err as Error).message, err);
        }
        throw err;
      }
    }
  }

  private refill(): void {
    const now = this.now();
    const elapsedMs = now - this.lastRefillAt;
    if (elapsedMs <= 0) return;
    const replenished = (elapsedMs * this.refillPerSec) / 1000;
    if (replenished < 1 && this.tokens >= 1) return;
    this.tokens = Math.min(this.capacity, this.tokens + replenished);
    this.lastRefillAt = now;
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractApiErrorCode(err: unknown): number | undefined {
  if (err instanceof APIError) {
    return typeof err.code === "number" ? err.code : Number(err.code);
  }
  return undefined;
}

export { VK_ERROR_FLOOD_CONTROL, VK_ERROR_TOO_MANY_REQUESTS };
