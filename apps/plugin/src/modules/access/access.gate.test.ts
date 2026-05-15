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
    received_at: new Date().toISOString(),
    ...over,
  };
}

describe("AccessGate.check", () => {
  it("allows when DM policy is open", () => {
    const gate = new AccessGate(
      makeStore({ ...ACCESS_FILE_DEFAULTS, policies: { dm: "open", group_chat: "pairing" } }),
    );
    expect(gate.check(makeMsg()).kind).toBe("allow");
  });

  it("returns need_pair for unknown peer under pairing policy", () => {
    const gate = new AccessGate(makeStore({ ...ACCESS_FILE_DEFAULTS }));
    expect(gate.check(makeMsg()).kind).toBe("need_pair");
  });

  it("drops unknown peer under allowlist policy", () => {
    const gate = new AccessGate(
      makeStore({ ...ACCESS_FILE_DEFAULTS, policies: { dm: "allowlist", group_chat: "pairing" } }),
    );
    const r = gate.check(makeMsg());
    expect(r.kind).toBe("drop");
    if (r.kind === "drop") expect(r.reason).toBe("chat-not-allowed");
  });

  it("allows when peer + sender are listed", () => {
    const gate = new AccessGate(
      makeStore({
        ...ACCESS_FILE_DEFAULTS,
        policies: { dm: "allowlist", group_chat: "pairing" },
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

  it("drops unlisted sender under allowlist policy even if chat is listed", () => {
    const gate = new AccessGate(
      makeStore({
        ...ACCESS_FILE_DEFAULTS,
        policies: { dm: "allowlist", group_chat: "pairing" },
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
});
