import "reflect-metadata";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, test } from "bun:test";
import type { InboundMessage } from "@/modules/inbound/inbound.types";
import type { ChannelNotifier } from "@/modules/inbound/notifier";
import type { SendMessageInput, SendMessageResult } from "@/modules/messaging/messaging.schema";
import type { MessagingService } from "@/modules/messaging/messaging.service";
import { PermissionRelayService } from "./permission-relay.service";

class FakeMessaging {
  sent: { input: SendMessageInput; options?: { keyboard?: string } }[] = [];
  result: SendMessageResult = { ok: true, conversation_message_ids: [1] };
  async send(input: SendMessageInput, options?: { keyboard?: string }): Promise<SendMessageResult> {
    this.sent.push({ input, options });
    return this.result;
  }
}

function verdictPayload(request_id: string, behavior: "allow" | "deny"): string {
  return JSON.stringify({ a: "verdict", r: request_id, b: behavior });
}

class FakeNotifier {
  warnings: string[] = [];
  async warn(content: string): Promise<void> {
    this.warnings.push(content);
  }
  async notify(): Promise<void> {
    /* unused in these tests */
  }
}

interface SentNotification {
  method: string;
  params: unknown;
}

function fakeMcp(): { mcp: McpServer; sent: SentNotification[] } {
  const sent: SentNotification[] = [];
  const mcp = {
    server: {
      notification: async (n: SentNotification): Promise<void> => {
        sent.push(n);
      },
    },
  } as unknown as McpServer;
  return { mcp, sent };
}

function dm(opts: {
  text?: string;
  payload?: string;
  from_id?: number;
  peer_id?: number;
}): InboundMessage {
  return {
    peer_id: opts.peer_id ?? 42,
    from_id: opts.from_id ?? 42,
    conversation_message_id: 1,
    text: opts.text ?? "",
    attachments: [],
    is_group_chat: false,
    mentioned_bot: false,
    is_reply_to_bot: false,
    payload: opts.payload,
    received_at: "2026-05-15T00:00:00.000Z",
  };
}

function groupChat(payload: string, from_id = 42): InboundMessage {
  return { ...dm({ payload, from_id, peer_id: 2_000_000_001 }), is_group_chat: true };
}

function build(): {
  service: PermissionRelayService;
  messaging: FakeMessaging;
  notifier: FakeNotifier;
  mcp: McpServer;
  sent: SentNotification[];
} {
  const messaging = new FakeMessaging();
  const notifier = new FakeNotifier();
  const { mcp, sent } = fakeMcp();
  const service = new PermissionRelayService(messaging as unknown as MessagingService);
  service.setNotifier(notifier as unknown as ChannelNotifier);
  service.setMcp(mcp);
  return { service, messaging, notifier, mcp, sent };
}

describe("PermissionRelayService.handleRequest", () => {
  test("with no DM activator, warns and does not send", async () => {
    const { service, messaging, notifier } = build();
    await service.handleRequest({ request_id: "abcde", tool_name: "Bash" });
    expect(messaging.sent).toHaveLength(0);
    expect(notifier.warnings).toHaveLength(1);
    expect(notifier.warnings[0]).toContain("abcde");
  });

  test("with DM activator, DMs the activator with prompt + verdict keyboard", async () => {
    const { service, messaging } = build();
    service.recordLastDmActivator(42, 42);
    await service.handleRequest({
      request_id: "abcde",
      tool_name: "Bash",
      description: "ls src/",
    });
    expect(messaging.sent).toHaveLength(1);
    const [call] = messaging.sent;
    expect(call!.input.peer_id).toBe(42);
    expect(call!.input.text).toContain("Bash");
    expect(call!.input.text).toContain("ls src/");
    expect(call!.input.text).toContain("Tap Allow");
    expect(call!.options?.keyboard).toBeDefined();
    const kb = JSON.parse(call!.options!.keyboard!);
    expect(kb.inline).toBe(true);
    expect(Array.isArray(kb.buttons)).toBe(true);
    // First row has Allow + Deny with our verdict payload shape.
    const [allow, deny] = kb.buttons[0];
    expect(allow.action.label).toBe("Allow");
    expect(JSON.parse(allow.action.payload)).toEqual({
      a: "verdict",
      r: "abcde",
      b: "allow",
    });
    expect(deny.action.label).toBe("Deny");
    expect(JSON.parse(deny.action.payload)).toEqual({
      a: "verdict",
      r: "abcde",
      b: "deny",
    });
  });

  test("recordLastDmActivator overwrites prior values", async () => {
    const { service, messaging } = build();
    service.recordLastDmActivator(1, 1);
    service.recordLastDmActivator(2, 2);
    await service.handleRequest({ request_id: "abcde", tool_name: "X" });
    expect(messaging.sent[0]!.input.peer_id).toBe(2);
  });
});

describe("PermissionRelayService.tryResolveVerdict", () => {
  test("non-verdict message is not consumed", async () => {
    const { service } = build();
    expect(await service.tryResolveVerdict(dm({ text: "hello" }))).toBe(false);
  });

  test("text-shaped verdict (legacy) is not consumed — payload-only now", async () => {
    const { service, sent } = build();
    service.recordLastDmActivator(42, 42);
    await service.handleRequest({ request_id: "abcde", tool_name: "Bash" });
    expect(await service.tryResolveVerdict(dm({ text: "yes abcde" }))).toBe(false);
    expect(sent).toHaveLength(0);
  });

  test("verdict click in group chat is consumed (no relay) + warns", async () => {
    const { service, sent, notifier } = build();
    service.recordLastDmActivator(42, 42);
    await service.handleRequest({ request_id: "abcde", tool_name: "Bash" });
    expect(await service.tryResolveVerdict(groupChat(verdictPayload("abcde", "allow")))).toBe(true);
    expect(sent).toHaveLength(0);
    expect(notifier.warnings.some((w) => w.includes("group chat"))).toBe(true);
  });

  test("verdict click for unknown/expired request is still consumed", async () => {
    const { service, sent } = build();
    const consumed = await service.tryResolveVerdict(
      dm({ payload: verdictPayload("zzzzz", "allow") }),
    );
    expect(consumed).toBe(true);
    expect(sent).toHaveLength(0);
  });

  test("verdict click from wrong user is consumed silently with a warning", async () => {
    const { service, sent, notifier } = build();
    service.recordLastDmActivator(42, 42);
    await service.handleRequest({ request_id: "abcde", tool_name: "Bash" });
    const consumed = await service.tryResolveVerdict(
      dm({ payload: verdictPayload("abcde", "allow"), from_id: 999, peer_id: 999 }),
    );
    expect(consumed).toBe(true);
    expect(sent).toHaveLength(0);
    expect(notifier.warnings.some((w) => w.includes("non-originating"))).toBe(true);
  });

  test("verdict click from originating user emits permission notification (allow)", async () => {
    const { service, sent } = build();
    service.recordLastDmActivator(42, 42);
    await service.handleRequest({ request_id: "abcde", tool_name: "Bash" });
    expect(await service.tryResolveVerdict(dm({ payload: verdictPayload("abcde", "allow") }))).toBe(
      true,
    );
    expect(sent).toEqual([
      {
        method: "notifications/claude/channel/permission",
        params: { request_id: "abcde", behavior: "allow" },
      },
    ]);
  });

  test("deny click maps to deny", async () => {
    const { service, sent } = build();
    service.recordLastDmActivator(42, 42);
    await service.handleRequest({ request_id: "abcde", tool_name: "Bash" });
    await service.tryResolveVerdict(dm({ payload: verdictPayload("abcde", "deny") }));
    expect((sent[0]!.params as { behavior: string }).behavior).toBe("deny");
  });

  test("a verdict can only be consumed once", async () => {
    const { service, sent } = build();
    service.recordLastDmActivator(42, 42);
    await service.handleRequest({ request_id: "abcde", tool_name: "Bash" });
    await service.tryResolveVerdict(dm({ payload: verdictPayload("abcde", "allow") }));
    // Second attempt: pending is gone, but the click is still consumed.
    expect(await service.tryResolveVerdict(dm({ payload: verdictPayload("abcde", "allow") }))).toBe(
      true,
    );
    expect(sent).toHaveLength(1);
  });
});
