import { describe, expect, test } from "bun:test";
import { vkMessageToInbound } from "./message-adapter";

const baseMessage = {
  id: 42,
  peer_id: 2_000_000_001,
  from_id: 123,
  conversation_message_id: 7,
  text: "hi",
};

describe("vkMessageToInbound", () => {
  test("maps core fields", () => {
    const msg = vkMessageToInbound(baseMessage);
    expect(msg.peer_id).toBe(2_000_000_001);
    expect(msg.from_id).toBe(123);
    expect(msg.conversation_message_id).toBe(7);
    expect(msg.text).toBe("hi");
    expect(msg.attachments).toEqual([]);
    expect(msg.reply_to).toBeUndefined();
    expect(msg.is_group_chat).toBe(true);
    expect(msg.mentioned_bot).toBe(false);
    expect(msg.is_reply_to_bot).toBe(false);
  });

  test("defaults missing peer_id/from_id to 0 (downstream gate drops)", () => {
    const msg = vkMessageToInbound({});
    expect(msg.peer_id).toBe(0);
    expect(msg.from_id).toBe(0);
    expect(msg.is_group_chat).toBe(false);
  });

  test("handles undefined message", () => {
    const msg = vkMessageToInbound(undefined);
    expect(msg.peer_id).toBe(0);
    expect(msg.attachments).toEqual([]);
    expect(msg.text).toBe("");
  });

  test("DM peer_id => is_group_chat=false", () => {
    const msg = vkMessageToInbound({ ...baseMessage, peer_id: 12345 });
    expect(msg.is_group_chat).toBe(false);
  });

  test("falls back to message id when conversation_message_id is missing", () => {
    const msg = vkMessageToInbound({ id: 99, peer_id: 1, from_id: 1, text: "x" });
    expect(msg.conversation_message_id).toBe(99);
  });

  test("photo attachment picks largest size by area", () => {
    const msg = vkMessageToInbound({
      ...baseMessage,
      attachments: [
        {
          type: "photo",
          photo: {
            sizes: [
              { url: "https://u.com/small.jpg", width: 100, height: 100 },
              { url: "https://u.com/large.jpg", width: 800, height: 600 },
              { url: "https://u.com/medium.jpg", width: 400, height: 300 },
            ],
          },
        },
      ],
    });
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments[0]).toEqual({
      type: "photo",
      url: "https://u.com/large.jpg",
    });
  });

  test("photo falls back to last size when width/height absent", () => {
    const msg = vkMessageToInbound({
      ...baseMessage,
      attachments: [
        {
          type: "photo",
          photo: {
            sizes: [{ url: "https://u.com/a.jpg" }, { url: "https://u.com/b.jpg" }],
          },
        },
      ],
    });
    expect(msg.attachments[0]!.url).toBe("https://u.com/b.jpg");
  });

  test("audio_message prefers link_ogg", () => {
    const msg = vkMessageToInbound({
      ...baseMessage,
      attachments: [
        {
          type: "audio_message",
          audio_message: {
            link_ogg: "https://u.com/v.ogg",
            link_mp3: "https://u.com/v.mp3",
          },
        },
      ],
    });
    expect(msg.attachments[0]!.url).toBe("https://u.com/v.ogg");
  });

  test("audio_message falls back to link_mp3", () => {
    const msg = vkMessageToInbound({
      ...baseMessage,
      attachments: [{ type: "audio_message", audio_message: { link_mp3: "https://u.com/v.mp3" } }],
    });
    expect(msg.attachments[0]!.url).toBe("https://u.com/v.mp3");
  });

  test("doc picks url", () => {
    const msg = vkMessageToInbound({
      ...baseMessage,
      attachments: [{ type: "doc", doc: { url: "https://u.com/x.pdf" } }],
    });
    expect(msg.attachments[0]!.url).toBe("https://u.com/x.pdf");
  });

  test("unknown attachment types preserve type with undefined url", () => {
    const msg = vkMessageToInbound({
      ...baseMessage,
      attachments: [{ type: "sticker" }, { type: "wall" }],
    });
    expect(msg.attachments).toEqual([
      { type: "sticker", url: undefined },
      { type: "wall", url: undefined },
    ]);
  });

  test("reply_message prefers conversation_message_id", () => {
    const msg = vkMessageToInbound({
      ...baseMessage,
      reply_message: { conversation_message_id: 5, id: 9999 },
    });
    expect(msg.reply_to).toBe(5);
  });

  test("reply_message falls back to id", () => {
    const msg = vkMessageToInbound({
      ...baseMessage,
      reply_message: { id: 9999 },
    });
    expect(msg.reply_to).toBe(9999);
  });
});
