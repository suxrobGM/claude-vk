import { describe, expect, it } from "bun:test";
import { normalize, type RawInbound } from "./router";

describe("normalize", () => {
  it("normalizes a DM payload with text and no attachments", () => {
    const raw: RawInbound = {
      peer_id: 12345,
      from_id: 12345,
      conversation_message_id: 7,
      text: "hello",
      attachments: [],
    };
    const msg = normalize(raw);
    expect(msg.peer_id).toBe(12345);
    expect(msg.from_id).toBe(12345);
    expect(msg.conversation_message_id).toBe(7);
    expect(msg.text).toBe("hello");
    expect(msg.attachments).toEqual([]);
    expect(msg.is_group_chat).toBe(false);
    expect(msg.mentioned_bot).toBe(false);
    expect(msg.reply_to).toBeUndefined();
  });

  it("marks is_group_chat when peer_id is in the group-chat range", () => {
    const msg = normalize({
      peer_id: 2_000_000_042,
      from_id: 123,
      conversation_message_id: 1,
      text: "hi",
    });
    expect(msg.is_group_chat).toBe(true);
  });

  it("extracts reply_to from the reply field, preferring conversation_message_id", () => {
    const msg = normalize({
      peer_id: 1,
      from_id: 1,
      conversation_message_id: 5,
      text: "re:",
      reply: { conversation_message_id: 99, message_id: 100 },
    });
    expect(msg.reply_to).toBe(99);
  });

  it("falls back to message_id when conversation_message_id is missing", () => {
    const msg = normalize({
      peer_id: 1,
      from_id: 1,
      conversation_message_id: undefined,
      message_id: 42,
      text: "x",
    });
    expect(msg.conversation_message_id).toBe(42);
  });

  it("passes attachment shape through with url and type", () => {
    const msg = normalize({
      peer_id: 1,
      from_id: 1,
      conversation_message_id: 1,
      text: "",
      attachments: [
        { type: "photo", url: "https://sun9.userapi.com/abc.jpg" },
        { type: "audio_message", url: "https://psv4.userapi.com/v.ogg" },
      ],
    });
    expect(msg.attachments).toEqual([
      { type: "photo", url: "https://sun9.userapi.com/abc.jpg" },
      { type: "audio_message", url: "https://psv4.userapi.com/v.ogg" },
    ]);
  });

  it("defaults missing text to empty string", () => {
    const msg = normalize({
      peer_id: 1,
      from_id: 1,
      conversation_message_id: 1,
      text: undefined,
    });
    expect(msg.text).toBe("");
  });
});
