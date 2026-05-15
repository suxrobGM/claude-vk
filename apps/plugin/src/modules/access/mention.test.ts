import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { InboundMessage } from "@/modules/inbound/inbound.types";
import { StateStore } from "@/state/state.store";
import { isPairCommand, MentionDetector } from "./mention";

interface RecentMessage {
  peer_id: number;
  conversation_message_id: number;
}

function makeStateStore(recent: RecentMessage[]): StateStore {
  const store = new StateStore();
  (store as unknown as { store: { get(): { recent_messages: RecentMessage[] } } }).store = {
    get: () => ({ recent_messages: recent }),
  };
  return store;
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

const originalCommunityId = process.env.VK_COMMUNITY_ID;
const originalScreenName = process.env.VK_COMMUNITY_SCREEN_NAME;

beforeEach(() => {
  process.env.VK_COMMUNITY_ID = "12345";
  process.env.VK_COMMUNITY_SCREEN_NAME = "claudebot";
  // Force config reload so the next current() reads the new env.
  const { reload } = require("@/config") as typeof import("@/config");
  reload();
});

afterEach(() => {
  if (originalCommunityId === undefined) delete process.env.VK_COMMUNITY_ID;
  else process.env.VK_COMMUNITY_ID = originalCommunityId;
  if (originalScreenName === undefined) delete process.env.VK_COMMUNITY_SCREEN_NAME;
  else process.env.VK_COMMUNITY_SCREEN_NAME = originalScreenName;
  const { reload } = require("@/config") as typeof import("@/config");
  reload();
});

describe("MentionDetector.detect", () => {
  it("detects canonical [club{ID}|...] mention", () => {
    const det = new MentionDetector(makeStateStore([]));
    const sig = det.detect(makeMsg({ text: "Hey [club12345|@claudebot] ping" }));
    expect(sig.name_mention).toBe(true);
    expect(sig.reply_to_bot).toBe(false);
  });

  it("ignores [club{ID}|...] when ID does not match community", () => {
    const det = new MentionDetector(makeStateStore([]));
    const sig = det.detect(makeMsg({ text: "Hey [club99999|@other] ping" }));
    expect(sig.name_mention).toBe(false);
  });

  it("detects @<screen_name> mention case-insensitively", () => {
    const det = new MentionDetector(makeStateStore([]));
    const sig = det.detect(makeMsg({ text: "yo @ClaudeBot what's up" }));
    expect(sig.name_mention).toBe(true);
  });

  it("ignores @<other_name> mentions", () => {
    const det = new MentionDetector(makeStateStore([]));
    const sig = det.detect(makeMsg({ text: "yo @someone_else" }));
    expect(sig.name_mention).toBe(false);
  });

  it("detects reply_to that matches a recent bot message for this peer", () => {
    const det = new MentionDetector(
      makeStateStore([{ peer_id: 2_000_000_001, conversation_message_id: 999 }]),
    );
    const sig = det.detect(makeMsg({ reply_to: 999 }));
    expect(sig.reply_to_bot).toBe(true);
  });

  it("does not flag reply_to from a different peer", () => {
    const det = new MentionDetector(
      makeStateStore([{ peer_id: 2_000_000_002, conversation_message_id: 999 }]),
    );
    const sig = det.detect(makeMsg({ reply_to: 999 }));
    expect(sig.reply_to_bot).toBe(false);
  });

  it("keyboard_payload is false in v1 (no payload field on InboundMessage yet)", () => {
    const det = new MentionDetector(makeStateStore([]));
    const sig = det.detect(makeMsg({ text: "" }));
    expect(sig.keyboard_payload).toBe(false);
  });
});

describe("isPairCommand", () => {
  it("returns true only when name_mention + 'pair' keyword present", () => {
    const msg = makeMsg({ text: "@claudebot pair me please" });
    expect(
      isPairCommand(msg, { name_mention: true, reply_to_bot: false, keyboard_payload: false }),
    ).toBe(true);
  });

  it("returns false without a name mention", () => {
    const msg = makeMsg({ text: "pair me" });
    expect(
      isPairCommand(msg, { name_mention: false, reply_to_bot: true, keyboard_payload: false }),
    ).toBe(false);
  });

  it("returns false without the 'pair' keyword", () => {
    const msg = makeMsg({ text: "@claudebot ping" });
    expect(
      isPairCommand(msg, { name_mention: true, reply_to_bot: false, keyboard_payload: false }),
    ).toBe(false);
  });
});
