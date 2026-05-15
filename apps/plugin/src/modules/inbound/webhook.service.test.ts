import "reflect-metadata";
import { beforeEach, describe, expect, test } from "bun:test";
import type { StatusRegistry } from "@/common/status";
import type { EventIdDedup } from "./event-dedup";
import type { InboundService } from "./inbound.service";
import type { InboundMessage } from "./inbound.types";
import type { WebhookEnvelope } from "./webhook.schema";
import { WebhookService } from "./webhook.service";

class FakeInbound {
  handled: InboundMessage[] = [];
  async handle(msg: InboundMessage): Promise<void> {
    this.handled.push(msg);
  }
}

class FakeDedup {
  seen = new Set<string>();
  pushed: string[] = [];
  add(id: string): boolean {
    this.pushed.push(id);
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    return true;
  }
}

class FakeStatus {
  connected = 0;
  events = 0;
  markConnected(): void {
    this.connected++;
  }
  markEvent(): void {
    this.events++;
  }
}

function build(envOverrides: Record<string, string | undefined> = {}): {
  service: WebhookService;
  inbound: FakeInbound;
  dedup: FakeDedup;
  status: FakeStatus;
} {
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  const inbound = new FakeInbound();
  const dedup = new FakeDedup();
  const status = new FakeStatus();
  const service = new WebhookService(
    inbound as unknown as InboundService,
    dedup as unknown as EventIdDedup,
    status as unknown as StatusRegistry,
  );
  return { service, inbound, dedup, status };
}

const messageNew: WebhookEnvelope = {
  type: "message_new",
  event_id: "evt-1",
  object: {
    message: {
      id: 1,
      peer_id: 555,
      from_id: 555,
      conversation_message_id: 9,
      text: "hello",
    },
  },
};

const ORIGINAL_ENV = {
  VK_WEBHOOK_SECRET: process.env.VK_WEBHOOK_SECRET,
  VK_WEBHOOK_CONFIRMATION: process.env.VK_WEBHOOK_CONFIRMATION,
};

beforeEach(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("WebhookService.handle", () => {
  test("confirmation returns configured string and marks connected", async () => {
    const { service, status } = build({ VK_WEBHOOK_CONFIRMATION: "abc123" });
    const out = await service.handle({ type: "confirmation" });
    expect(out).toBe("abc123");
    expect(status.connected).toBe(1);
  });

  test("confirmation falls back to 'ok' when not configured", async () => {
    const { service } = build({ VK_WEBHOOK_CONFIRMATION: undefined });
    const out = await service.handle({ type: "confirmation" });
    expect(out).toBe("ok");
  });

  test("secret mismatch returns 'ok' and skips dispatch", async () => {
    const { service, inbound, dedup } = build({ VK_WEBHOOK_SECRET: "expected" });
    const out = await service.handle({ ...messageNew, secret: "wrong" });
    expect(out).toBe("ok");
    expect(inbound.handled).toHaveLength(0);
    expect(dedup.pushed).toHaveLength(0);
  });

  test("matching secret allows dispatch", async () => {
    const { service, inbound } = build({ VK_WEBHOOK_SECRET: "expected" });
    await service.handle({ ...messageNew, secret: "expected" });
    expect(inbound.handled).toHaveLength(1);
  });

  test("new event_id triggers inbound.handle exactly once and marks connected", async () => {
    const { service, inbound, dedup, status } = build();
    await service.handle(messageNew);
    expect(inbound.handled).toHaveLength(1);
    expect(dedup.pushed).toEqual(["evt-1"]);
    expect(status.events).toBe(1);
    expect(status.connected).toBe(1);
  });

  test("duplicate event_id is dropped", async () => {
    const { service, inbound, dedup } = build();
    await service.handle(messageNew);
    await service.handle(messageNew);
    expect(inbound.handled).toHaveLength(1);
    expect(dedup.pushed).toEqual(["evt-1", "evt-1"]);
  });

  test("missing event_id still dispatches (no dedup)", async () => {
    const { service, inbound, dedup } = build();
    const { event_id, ...withoutId } = messageNew;
    void event_id;
    await service.handle(withoutId);
    expect(inbound.handled).toHaveLength(1);
    expect(dedup.pushed).toHaveLength(0);
  });

  test("malformed message_new object returns 'ok' without dispatch", async () => {
    const { service, inbound } = build();
    const out = await service.handle({
      type: "message_new",
      event_id: "x",
      object: { not_a_message: true },
    });
    expect(out).toBe("ok");
    expect(inbound.handled).toHaveLength(0);
  });

  test("unknown event type returns 'ok' silently", async () => {
    const { service, inbound } = build();
    const out = await service.handle({ type: "group_join", event_id: "x" });
    expect(out).toBe("ok");
    expect(inbound.handled).toHaveLength(0);
  });
});
