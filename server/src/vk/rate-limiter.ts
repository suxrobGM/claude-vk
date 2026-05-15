import { singleton } from "tsyringe";
import { APIError } from "vk-io";
import { VkApiError } from "@/common/errors";
import { sleep } from "@/common/utils/sleep";

const VK_GROUP_REQ_PER_SEC = 20;
const VK_ERROR_TOO_MANY_REQUESTS = 6;
const VK_ERROR_FLOOD_CONTROL = 9;
const RETRY_BASE_MS = 250;
const RETRY_MAX_ATTEMPTS = 5;
const MIN_SLEEP_MS = 1;

/**
 * Token-bucket rate limiter wrapped around vk-io API calls. One bucket per
 * process — VK's 20 req/s quota is per community token, not per method.
 *
 * `withRetry` additionally swallows VK transient errors:
 *   - error 6 ("too many requests") retries up to 5× with `250 * attempt` ms backoff.
 *   - error 9 (flood control) is fatal — surfaces immediately.
 *   - any other vk-io `APIError` is rethrown as `VkApiError`.
 *
 * Constructor has no parameters so tsyringe can resolve it as an injectable
 * singleton. Tests subclass and override the {@link now} / {@link sleep}
 * protected seams.
 */
@singleton()
export class RateLimiter {
  protected capacity = VK_GROUP_REQ_PER_SEC;
  protected refillPerSec = VK_GROUP_REQ_PER_SEC;
  protected tokens = this.capacity;
  protected lastRefillAt = Date.now();

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
      await sleep(msUntilNext);
    }
  }

  /**
   * Wraps `fn` with {@link acquire} and the VK retry policy described on the
   * class. Throws {@link VkApiError} for known VK error codes.
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
          await sleep(RETRY_BASE_MS * attempt);
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
    const now = Date.now();
    const elapsedMs = now - this.lastRefillAt;
    if (elapsedMs <= 0) return;
    const replenished = (elapsedMs * this.refillPerSec) / 1000;
    if (replenished < 1 && this.tokens >= 1) return;
    this.tokens = Math.min(this.capacity, this.tokens + replenished);
    this.lastRefillAt = now;
  }
}

function extractApiErrorCode(err: unknown): number | undefined {
  if (err instanceof APIError) {
    return typeof err.code === "number" ? err.code : Number(err.code);
  }
  return undefined;
}

export { VK_ERROR_FLOOD_CONTROL, VK_ERROR_TOO_MANY_REQUESTS };
