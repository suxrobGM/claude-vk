import "reflect-metadata";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { APIError } from "vk-io";
import { VkApiError } from "@/common/errors";

const recorded: number[] = [];
let fakeNow = 0;
let useFakeClock = false;
const realDateNow = Date.now;

mock.module("@/common/utils/sleep", () => ({
  sleep: async (ms: number) => {
    recorded.push(ms);
    if (useFakeClock) fakeNow += ms;
  },
}));

// Imported AFTER the mock so the limiter binds to our stub.
const { RateLimiter } = await import("./rate-limiter");

class TestLimiter extends RateLimiter {
  constructor(opts: { capacity?: number; refillPerSec?: number }) {
    super();
    if (opts.capacity !== undefined) {
      (this as unknown as { capacity: number }).capacity = opts.capacity;
      (this as unknown as { tokens: number }).tokens = opts.capacity;
    }
    if (opts.refillPerSec !== undefined) {
      (this as unknown as { refillPerSec: number }).refillPerSec = opts.refillPerSec;
    }
    (this as unknown as { lastRefillAt: number }).lastRefillAt = Date.now();
  }
}

function makeApiError(code: number, message = "vk error"): APIError {
  return new APIError({ error_code: code, error_msg: message, request_params: [] });
}

beforeEach(() => {
  recorded.length = 0;
  fakeNow = 0;
  useFakeClock = false;
  Date.now = realDateNow;
});

describe("RateLimiter", () => {
  it("admits up to capacity without blocking", async () => {
    const limiter = new TestLimiter({ capacity: 3, refillPerSec: 1 });
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    expect(recorded).toEqual([]);
  });

  it("blocks when bucket is empty and resumes after the next refill", async () => {
    useFakeClock = true;
    fakeNow = 1_000_000;
    Date.now = () => fakeNow;
    const limiter = new TestLimiter({ capacity: 1, refillPerSec: 10 });
    await limiter.acquire(); // drains bucket
    await limiter.acquire(); // must sleep ~100ms (1 token / 10 per sec)
    expect(recorded.length).toBeGreaterThanOrEqual(1);
    expect(recorded[0]).toBeLessThanOrEqual(100);
    expect(recorded[0]).toBeGreaterThan(0);
  });

  it("retries on VK error 6 with linear backoff and eventually succeeds", async () => {
    const limiter = new TestLimiter({ capacity: 100, refillPerSec: 100 });
    let attempt = 0;
    const result = await limiter.withRetry(async () => {
      attempt += 1;
      if (attempt < 3) throw makeApiError(6);
      return "ok";
    });
    expect(result).toBe("ok");
    expect(attempt).toBe(3);
    expect(recorded).toEqual([250, 500]);
  });

  it("does not retry on VK error 9 (flood control); rethrows as VkApiError", async () => {
    const limiter = new TestLimiter({ capacity: 10, refillPerSec: 10 });
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
    const limiter = new TestLimiter({ capacity: 10, refillPerSec: 10 });
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
    const limiter = new TestLimiter({ capacity: 10, refillPerSec: 10 });
    await expect(
      limiter.withRetry(async () => {
        throw new TypeError("boom");
      }),
    ).rejects.toBeInstanceOf(TypeError);
  });
});
