import "reflect-metadata";
import { describe, expect, it } from "bun:test";
import type { InboundMessage } from "@/modules/inbound/inbound.types";
import { AccessGate } from "./access.gate";
import { ACCESS_FILE_DEFAULTS, type AccessFile } from "./access.schema";
import { AccessStore } from "./access.store";

function makeStore(file: AccessFile): AccessStore {
  const store = new AccessStore();
  // Bypass disk init — populate the internal store by hand.
  (store as unknown as { store: { get(): AccessFile } }).store = { get: () => file };
  return store;
}

function makeMsg(over: Partial<InboundMessage> = {}): InboundMessage {
  return {
    peer_id: 100,
    from_id: 100,
    conversation_message_id: 1,
    text: "",
    attachments: [],
    is_group_chat: false,
    mentioned_bot: false,
    is_reply_to_bot: false,
    received_at: new Date().toISOString(),
    ...over,
  };
}

const GROUP_PEER = 2_000_000_042;

describe("AccessGate.check", () => {
  it("returns need_pair for unknown peer under pairing policy", () => {
    const gate = new AccessGate(makeStore({ ...ACCESS_FILE_DEFAULTS }));
    expect(gate.check(makeMsg()).kind).toBe("need_pair");
  });

  it("denies unknown DM peer under allowlist policy with a reply", () => {
    const gate = new AccessGate(
      makeStore({ ...ACCESS_FILE_DEFAULTS, policies: { dm: "allowlist" } }),
    );
    const r = gate.check(makeMsg());
    expect(r.kind).toBe("deny_with_reply");
    if (r.kind === "deny_with_reply") expect(r.reason).toBe("chat-not-allowed");
  });

  it("silently drops unknown group-chat peer under allowlist policy", () => {
    const gate = new AccessGate(
      makeStore({ ...ACCESS_FILE_DEFAULTS, policies: { dm: "pairing" } }),
    );
    const r = gate.check(makeMsg({ peer_id: GROUP_PEER, is_group_chat: true }));
    expect(r.kind).toBe("drop");
    if (r.kind === "drop") expect(r.reason).toBe("chat-not-allowed");
  });

  it("allows when peer + sender are listed", () => {
    const gate = new AccessGate(
      makeStore({
        ...ACCESS_FILE_DEFAULTS,
        policies: { dm: "allowlist" },
        chats: {
          "100": {
            kind: "dm",
            senders: [100],
            added_at: new Date().toISOString(),
            added_by: "manual",
          },
        },
      }),
    );
    expect(gate.check(makeMsg()).kind).toBe("allow");
  });

  it("denies unlisted DM sender under allowlist policy with a reply", () => {
    const gate = new AccessGate(
      makeStore({
        ...ACCESS_FILE_DEFAULTS,
        policies: { dm: "allowlist" },
        chats: {
          "100": {
            kind: "dm",
            senders: [200], // not 100
            added_at: new Date().toISOString(),
            added_by: "manual",
          },
        },
      }),
    );
    const r = gate.check(makeMsg());
    expect(r.kind).toBe("deny_with_reply");
    if (r.kind === "deny_with_reply") expect(r.reason).toBe("sender-not-allowed");
  });

  it("silently drops unlisted group-chat sender under allowlist policy", () => {
    const gate = new AccessGate(
      makeStore({
        ...ACCESS_FILE_DEFAULTS,
        policies: { dm: "pairing" },
        chats: {
          [String(GROUP_PEER)]: {
            kind: "group_chat",
            senders: [200],
            mention_policy: "all",
            added_at: new Date().toISOString(),
            added_by: "manual",
          },
        },
      }),
    );
    const r = gate.check(makeMsg({ peer_id: GROUP_PEER, from_id: 100, is_group_chat: true }));
    expect(r.kind).toBe("drop");
    if (r.kind === "drop") expect(r.reason).toBe("sender-not-allowed");
  });

  it("returns need_pair for unlisted sender under pairing policy", () => {
    const gate = new AccessGate(
      makeStore({
        ...ACCESS_FILE_DEFAULTS,
        chats: {
          "100": {
            kind: "dm",
            senders: [200],
            added_at: new Date().toISOString(),
            added_by: "manual",
          },
        },
      }),
    );
    expect(gate.check(makeMsg()).kind).toBe("need_pair");
  });

  it("drops a non-mention in a group chat with mention_only policy", () => {
    const gate = new AccessGate(
      makeStore({
        ...ACCESS_FILE_DEFAULTS,
        policies: { dm: "pairing" },
        chats: {
          [String(GROUP_PEER)]: {
            kind: "group_chat",
            senders: [555],
            mention_policy: "mention_only",
            added_at: new Date().toISOString(),
            added_by: "manual",
          },
        },
      }),
    );
    const r = gate.check(
      makeMsg({ peer_id: GROUP_PEER, from_id: 555, is_group_chat: true, mentioned_bot: false }),
    );
    expect(r.kind).toBe("drop");
    if (r.kind === "drop") expect(r.reason).toBe("no-mention");
  });

  it("allows a mention in a group chat with mention_only policy", () => {
    const gate = new AccessGate(
      makeStore({
        ...ACCESS_FILE_DEFAULTS,
        policies: { dm: "pairing" },
        chats: {
          [String(GROUP_PEER)]: {
            kind: "group_chat",
            senders: [555],
            mention_policy: "mention_only",
            added_at: new Date().toISOString(),
            added_by: "manual",
          },
        },
      }),
    );
    expect(
      gate.check(
        makeMsg({ peer_id: GROUP_PEER, from_id: 555, is_group_chat: true, mentioned_bot: true }),
      ).kind,
    ).toBe("allow");
  });

  it("drops a plain mention under reply_only policy when not actually a reply-to-bot", () => {
    const gate = new AccessGate(
      makeStore({
        ...ACCESS_FILE_DEFAULTS,
        policies: { dm: "pairing" },
        chats: {
          [String(GROUP_PEER)]: {
            kind: "group_chat",
            senders: [555],
            mention_policy: "reply_only",
            added_at: new Date().toISOString(),
            added_by: "manual",
          },
        },
      }),
    );
    const r = gate.check(
      makeMsg({
        peer_id: GROUP_PEER,
        from_id: 555,
        is_group_chat: true,
        mentioned_bot: true,
        is_reply_to_bot: false,
      }),
    );
    expect(r.kind).toBe("drop");
    if (r.kind === "drop") expect(r.reason).toBe("no-reply-to-bot");
  });

  it("allows reply_to_bot under reply_only policy", () => {
    const gate = new AccessGate(
      makeStore({
        ...ACCESS_FILE_DEFAULTS,
        policies: { dm: "pairing" },
        chats: {
          [String(GROUP_PEER)]: {
            kind: "group_chat",
            senders: [555],
            mention_policy: "reply_only",
            added_at: new Date().toISOString(),
            added_by: "manual",
          },
        },
      }),
    );
    expect(
      gate.check(
        makeMsg({
          peer_id: GROUP_PEER,
          from_id: 555,
          is_group_chat: true,
          is_reply_to_bot: true,
        }),
      ).kind,
    ).toBe("allow");
  });

  it("allows any message under mention_policy=all", () => {
    const gate = new AccessGate(
      makeStore({
        ...ACCESS_FILE_DEFAULTS,
        policies: { dm: "pairing" },
        chats: {
          [String(GROUP_PEER)]: {
            kind: "group_chat",
            senders: [555],
            mention_policy: "all",
            added_at: new Date().toISOString(),
            added_by: "manual",
          },
        },
      }),
    );
    expect(
      gate.check(makeMsg({ peer_id: GROUP_PEER, from_id: 555, is_group_chat: true })).kind,
    ).toBe("allow");
  });

  it("allows any sender when group-chat senders[] is empty (post-add default)", () => {
    const gate = new AccessGate(
      makeStore({
        ...ACCESS_FILE_DEFAULTS,
        policies: { dm: "pairing" },
        chats: {
          [String(GROUP_PEER)]: {
            kind: "group_chat",
            senders: [], // explicit `group add` may leave this empty
            mention_policy: "all",
            added_at: new Date().toISOString(),
            added_by: "manual",
          },
        },
      }),
    );
    expect(
      gate.check(makeMsg({ peer_id: GROUP_PEER, from_id: 999, is_group_chat: true })).kind,
    ).toBe("allow");
  });

  it("still applies mention_policy when senders[] is empty", () => {
    const gate = new AccessGate(
      makeStore({
        ...ACCESS_FILE_DEFAULTS,
        policies: { dm: "pairing" },
        chats: {
          [String(GROUP_PEER)]: {
            kind: "group_chat",
            senders: [],
            mention_policy: "mention_only",
            added_at: new Date().toISOString(),
            added_by: "pairing",
          },
        },
      }),
    );
    const r = gate.check(
      makeMsg({ peer_id: GROUP_PEER, from_id: 999, is_group_chat: true, mentioned_bot: false }),
    );
    expect(r.kind).toBe("drop");
    if (r.kind === "drop") expect(r.reason).toBe("no-mention");
  });

  it("silently drops every DM under disabled policy, even allowlisted senders", () => {
    const gate = new AccessGate(
      makeStore({
        ...ACCESS_FILE_DEFAULTS,
        policies: { dm: "disabled" },
        chats: {
          "100": {
            kind: "dm",
            senders: [100],
            added_at: new Date().toISOString(),
            added_by: "manual",
          },
        },
      }),
    );
    const r = gate.check(makeMsg());
    expect(r.kind).toBe("drop");
    if (r.kind === "drop") expect(r.reason).toBe("disabled");
  });

  it("disabled policy also drops allowed group chats (global kill switch)", () => {
    const gate = new AccessGate(
      makeStore({
        ...ACCESS_FILE_DEFAULTS,
        policies: { dm: "disabled" },
        chats: {
          [String(GROUP_PEER)]: {
            kind: "group_chat",
            senders: [555],
            mention_policy: "all",
            added_at: new Date().toISOString(),
            added_by: "manual",
          },
        },
      }),
    );
    const r = gate.check(makeMsg({ peer_id: GROUP_PEER, from_id: 555, is_group_chat: true }));
    expect(r.kind).toBe("drop");
    if (r.kind === "drop") expect(r.reason).toBe("disabled");
  });

  it("defaults to mention_only when chat has no mention_policy set", () => {
    const gate = new AccessGate(
      makeStore({
        ...ACCESS_FILE_DEFAULTS,
        policies: { dm: "pairing" },
        chats: {
          [String(GROUP_PEER)]: {
            kind: "group_chat",
            senders: [555],
            added_at: new Date().toISOString(),
            added_by: "pairing",
          },
        },
      }),
    );
    const r = gate.check(
      makeMsg({ peer_id: GROUP_PEER, from_id: 555, is_group_chat: true, mentioned_bot: false }),
    );
    expect(r.kind).toBe("drop");
    if (r.kind === "drop") expect(r.reason).toBe("no-mention");
  });
});
