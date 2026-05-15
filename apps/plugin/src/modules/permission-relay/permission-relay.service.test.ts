import "reflect-metadata";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, test } from "bun:test";
import type { InboundMessage } from "@/modules/inbound/inbound.types";
import type { ChannelNotifier } from "@/modules/inbound/notifier";
import type { SendMessageInput, SendMessageResult } from "@/modules/messaging/messaging.schema";
import type { MessagingService } from "@/modules/messaging/messaging.service";
import { PermissionRelayService } from "./permission-relay.service";

class FakeMessaging {
  sent: SendMessageInput[] = [];
  result: SendMessageResult = { ok: true, conversation_message_ids: [1] };
  async send(input: SendMessageInput): Promise<SendMessageResult> {
    this.sent.push(input);
    return this.result;
  }
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

function dm(text: string, from_id = 42, peer_id = 42): InboundMessage {
  return {
    peer_id,
    from_id,
    conversation_message_id: 1,
    text,
    attachments: [],
    is_group_chat: false,
    mentioned_bot: false,
    is_reply_to_bot: false,
    received_at: "2026-05-15T00:00:00.000Z",
  };
}

function groupChat(text: string, from_id = 42): InboundMessage {
  return { ...dm(text, from_id, 2_000_000_001), is_group_chat: true };
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

  test("with DM activator, DMs the activator with formatted prompt", async () => {
    const { service, messaging } = build();
    service.recordLastDmActivator(42, 42);
    await service.handleRequest({
      request_id: "abcde",
      tool_name: "Bash",
      description: "ls src/",
    });
    expect(messaging.sent).toHaveLength(1);
    expect(messaging.sent[0]!.peer_id).toBe(42);
    expect(messaging.sent[0]!.text).toContain("Bash");
    expect(messaging.sent[0]!.text).toContain("abcde");
    expect(messaging.sent[0]!.text).toContain("ls src/");
  });

  test("recordLastDmActivator overwrites prior values", async () => {
    const { service, messaging } = build();
    service.recordLastDmActivator(1, 1);
    service.recordLastDmActivator(2, 2);
    await service.handleRequest({ request_id: "abcde", tool_name: "X" });
    expect(messaging.sent[0]!.peer_id).toBe(2);
  });
});

describe("PermissionRelayService.tryResolveVerdict", () => {
  test("non-verdict text is not consumed", async () => {
    const { service } = build();
    expect(await service.tryResolveVerdict(dm("hello"))).toBe(false);
  });

  test("verdict in group chat is consumed (no relay) + warns", async () => {
    const { service, sent, notifier } = build();
    service.recordLastDmActivator(42, 42);
    await service.handleRequest({ request_id: "abcde", tool_name: "Bash" });
    expect(await service.tryResolveVerdict(groupChat("yes abcde"))).toBe(true);
    expect(sent).toHaveLength(0);
    expect(notifier.warnings.some((w) => w.includes("group chat"))).toBe(true);
  });

  test("verdict with no matching pending request flows through", async () => {
    const { service, sent } = build();
    expect(await service.tryResolveVerdict(dm("yes abcde"))).toBe(false);
    expect(sent).toHaveLength(0);
  });

  test("verdict from wrong user is consumed silently with a warning", async () => {
    const { service, sent, notifier } = build();
    service.recordLastDmActivator(42, 42);
    await service.handleRequest({ request_id: "abcde", tool_name: "Bash" });
    const consumed = await service.tryResolveVerdict(dm("yes abcde", 999, 999));
    expect(consumed).toBe(true);
    expect(sent).toHaveLength(0);
    expect(notifier.warnings.some((w) => w.includes("non-originating"))).toBe(true);
  });

  test("verdict from originating user emits permission notification (allow)", async () => {
    const { service, sent } = build();
    service.recordLastDmActivator(42, 42);
    await service.handleRequest({ request_id: "abcde", tool_name: "Bash" });
    expect(await service.tryResolveVerdict(dm("yes abcde"))).toBe(true);
    expect(sent).toEqual([
      {
        method: "notifications/claude/channel/permission",
        params: { request_id: "abcde", behavior: "allow" },
      },
    ]);
  });

  test("verdict 'no' maps to deny", async () => {
    const { service, sent } = build();
    service.recordLastDmActivator(42, 42);
    await service.handleRequest({ request_id: "abcde", tool_name: "Bash" });
    await service.tryResolveVerdict(dm("no abcde"));
    expect((sent[0]!.params as { behavior: string }).behavior).toBe("deny");
  });

  test("a verdict can only be consumed once", async () => {
    const { service, sent } = build();
    service.recordLastDmActivator(42, 42);
    await service.handleRequest({ request_id: "abcde", tool_name: "Bash" });
    await service.tryResolveVerdict(dm("yes abcde"));
    // Second attempt: pending is gone, so it flows through.
    expect(await service.tryResolveVerdict(dm("yes abcde"))).toBe(false);
    expect(sent).toHaveLength(1);
  });
});
