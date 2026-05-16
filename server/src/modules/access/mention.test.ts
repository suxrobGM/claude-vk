import "reflect-metadata";
import { describe, expect, it } from "bun:test";
import type { InboundMessage } from "@/modules/inbound/inbound.types";
import { RecentSentMessages } from "@/modules/messaging/recent-sent";
import type { VkClient } from "@/vk/client";
import type { AccessStore } from "./access.store";
import { CommunityResolver, type CommunityIdentity } from "./community-resolver";
import { MentionDetector } from "./mention";
import type { AccessFile } from "./schemas/access-file.schema";

function makeRecent(
  entries: { peer_id: number; conversation_message_id: number }[],
): RecentSentMessages {
  const recent = new RecentSentMessages();
  for (const e of entries) recent.push(e.peer_id, e.conversation_message_id);
  return recent;
}

function makeAccess(patterns: string[] = []): AccessStore {
  const snapshot: AccessFile = {
    version: 1,
    dmPolicy: "pairing",
    mentionPatterns: patterns,
    chats: {},
    pendingPairs: {},
  };
  return { get: () => snapshot } as unknown as AccessStore;
}

function makeDetector(recent: RecentSentMessages, patterns: string[] = []): MentionDetector {
  // Seed the resolver's identity directly — bypasses the VK call.
  const stubVk = {} as unknown as VkClient;
  const resolver = new CommunityResolver(stubVk);
  const identity: CommunityIdentity = { id: "12345", screenName: "claudebot" };
  (resolver as unknown as { identity: CommunityIdentity }).identity = identity;
  return new MentionDetector(recent, resolver, makeAccess(patterns));
}

function makeMsg(over: Partial<InboundMessage> = {}): InboundMessage {
  return {
    peer_id: 2_000_000_001,
    from_id: 555,
    conversation_message_id: 42,
    text: "",
    attachments: [],
    is_group_chat: true,
    mentioned_bot: false,
    is_reply_to_bot: false,
    received_at: new Date().toISOString(),
    ...over,
  };
}

describe("MentionDetector.detect", () => {
  it("detects canonical [club{ID}|...] mention", () => {
    const det = makeDetector(makeRecent([]));
    const sig = det.detect(makeMsg({ text: "Hey [club12345|@claudebot] ping" }));
    expect(sig.name_mention).toBe(true);
    expect(sig.reply_to_bot).toBe(false);
  });

  it("ignores [club{ID}|...] when ID does not match community", () => {
    const det = makeDetector(makeRecent([]));
    const sig = det.detect(makeMsg({ text: "Hey [club99999|@other] ping" }));
    expect(sig.name_mention).toBe(false);
  });

  it("detects @<screen_name> mention case-insensitively", () => {
    const det = makeDetector(makeRecent([]));
    const sig = det.detect(makeMsg({ text: "yo @ClaudeBot what's up" }));
    expect(sig.name_mention).toBe(true);
  });

  it("ignores @<other_name> mentions", () => {
    const det = makeDetector(makeRecent([]));
    const sig = det.detect(makeMsg({ text: "yo @someone_else" }));
    expect(sig.name_mention).toBe(false);
  });

  it("detects reply_to that matches a recent bot message for this peer", () => {
    const det = makeDetector(
      makeRecent([{ peer_id: 2_000_000_001, conversation_message_id: 999 }]),
    );
    const sig = det.detect(makeMsg({ reply_to: 999 }));
    expect(sig.reply_to_bot).toBe(true);
  });

  it("does not flag reply_to from a different peer", () => {
    const det = makeDetector(
      makeRecent([{ peer_id: 2_000_000_002, conversation_message_id: 999 }]),
    );
    const sig = det.detect(makeMsg({ reply_to: 999 }));
    expect(sig.reply_to_bot).toBe(false);
  });

  it("keyboard_payload is false in v1 (no payload field on InboundMessage yet)", () => {
    const det = makeDetector(makeRecent([]));
    const sig = det.detect(makeMsg({ text: "" }));
    expect(sig.keyboard_payload).toBe(false);
  });

  it("detects reply_to by community-id even without a recent-sent entry (restart-safe)", () => {
    const det = makeDetector(makeRecent([]));
    const sig = det.detect(makeMsg({ reply_to: 999, reply_to_from_id: -12345 }));
    expect(sig.reply_to_bot).toBe(true);
  });

  it("does not flag reply_to when quoted from_id is not the community", () => {
    const det = makeDetector(makeRecent([]));
    const sig = det.detect(makeMsg({ reply_to: 999, reply_to_from_id: 777 }));
    expect(sig.reply_to_bot).toBe(false);
  });

  it("detects friendly mentionPatterns (case-insensitive, word-bounded)", () => {
    const det = makeDetector(makeRecent([]), ["claude", "клод"]);
    expect(det.detect(makeMsg({ text: "Hey Claude, do X" })).name_mention).toBe(true);
    expect(det.detect(makeMsg({ text: "клод, привет" })).name_mention).toBe(true);
    expect(det.detect(makeMsg({ text: "клод?" })).name_mention).toBe(true);
  });

  it("does not match mentionPatterns inside longer words", () => {
    const det = makeDetector(makeRecent([]), ["claude"]);
    expect(det.detect(makeMsg({ text: "claudette test" })).name_mention).toBe(false);
  });

  it("empty mentionPatterns array does not crash and matches nothing extra", () => {
    const det = makeDetector(makeRecent([]), []);
    expect(det.detect(makeMsg({ text: "random chatter" })).name_mention).toBe(false);
  });

  it("mentionPatterns with regex metacharacters are treated as literals", () => {
    const det = makeDetector(makeRecent([]), ["c.aude"]);
    expect(det.detect(makeMsg({ text: "claude here" })).name_mention).toBe(false);
    expect(det.detect(makeMsg({ text: "say c.aude" })).name_mention).toBe(true);
  });
});
