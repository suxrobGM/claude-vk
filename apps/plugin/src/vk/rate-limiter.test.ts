import "reflect-metadata";
import { describe, expect, it } from "bun:test";
import { APIError } from "vk-io";
import { VkApiError } from "@/common/errors";
import { RateLimiter } from "./rate-limiter";

function makeApiError(code: number, message = "vk error"): APIError {
  return new APIError({
    error_code: code,
    error_msg: message,
    request_params: [],
  });
}

describe("RateLimiter", () => {
  it("admits up to capacity without blocking", async () => {
    const limiter = new RateLimiter({
      capacity: 3,
      refillPerSec: 1,
      sleep: async () => {
        throw new Error("should not sleep");
      },
    });
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
  });

  it("blocks when bucket is empty and resumes after the next refill", async () => {
    let now = 1_000_000;
    const sleeps: number[] = [];
    const limiter = new RateLimiter({
      capacity: 1,
      refillPerSec: 10,
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
    });
    await limiter.acquire(); // drains bucket
    await limiter.acquire(); // must sleep ~100ms (1 token / 10 per sec)
    expect(sleeps.length).toBeGreaterThanOrEqual(1);
    expect(sleeps[0]).toBeLessThanOrEqual(100);
    expect(sleeps[0]).toBeGreaterThan(0);
  });

  it("retries on VK error 6 with linear backoff and eventually succeeds", async () => {
    const sleeps: number[] = [];
    const limiter = new RateLimiter({
      capacity: 100,
      refillPerSec: 100,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    let attempt = 0;
    const result = await limiter.withRetry(async () => {
      attempt += 1;
      if (attempt < 3) throw makeApiError(6);
      return "ok";
    });

    expect(result).toBe("ok");
    expect(attempt).toBe(3);
    expect(sleeps).toEqual([250, 500]);
  });

  it("does not retry on VK error 9 (flood control); rethrows as VkApiError", async () => {
    const limiter = new RateLimiter({ capacity: 10, refillPerSec: 10 });
    let attempts = 0;
    await expect(
      limiter.withRetry(async () => {
        attempts += 1;
        throw makeApiError(9, "flood");
      }),
    ).rejects.toBeInstanceOf(VkApiError);
    expect(attempts).toBe(1);
  });

  it("wraps generic VK API errors as VkApiError", async () => {
    const limiter = new RateLimiter({ capacity: 10, refillPerSec: 10 });
    try {
      await limiter.withRetry(async () => {
        throw makeApiError(100, "bad params");
      });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(VkApiError);
      expect((err as VkApiError).vkErrorCode).toBe(100);
      expect((err as VkApiError).code).toBe("vk_api_100");
    }
  });

  it("propagates non-VK errors unchanged", async () => {
    const limiter = new RateLimiter({ capacity: 10, refillPerSec: 10 });
    await expect(
      limiter.withRetry(async () => {
        throw new TypeError("boom");
      }),
    ).rejects.toBeInstanceOf(TypeError);
  });
});
