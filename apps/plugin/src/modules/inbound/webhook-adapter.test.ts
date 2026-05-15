import { describe, expect, test } from "bun:test";
import { webhookMessageNewToRaw, type VkCallbackMessageNewObject } from "./webhook-adapter";

const baseMessage = {
  id: 42,
  peer_id: 2_000_000_001,
  from_id: 123,
  conversation_message_id: 7,
  text: "hi",
};

describe("webhookMessageNewToRaw", () => {
  test("maps core fields", () => {
    const raw = webhookMessageNewToRaw({ message: baseMessage });
    expect(raw.peer_id).toBe(2_000_000_001);
    expect(raw.from_id).toBe(123);
    expect(raw.conversation_message_id).toBe(7);
    expect(raw.message_id).toBe(42);
    expect(raw.text).toBe("hi");
    expect(raw.attachments).toEqual([]);
    expect(raw.reply).toBeUndefined();
  });

  test("defaults missing peer_id/from_id to 0 (downstream gate drops)", () => {
    const raw = webhookMessageNewToRaw({ message: {} });
    expect(raw.peer_id).toBe(0);
    expect(raw.from_id).toBe(0);
  });

  test("handles empty object", () => {
    const raw = webhookMessageNewToRaw({} as VkCallbackMessageNewObject);
    expect(raw.peer_id).toBe(0);
    expect(raw.attachments).toEqual([]);
  });

  test("photo attachment picks largest size by area", () => {
    const raw = webhookMessageNewToRaw({
      message: {
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
      },
    });
    expect(raw.attachments).toHaveLength(1);
    expect(raw.attachments![0]).toEqual({
      type: "photo",
      url: "https://u.com/large.jpg",
    });
  });

  test("photo falls back to last size when width/height absent", () => {
    const raw = webhookMessageNewToRaw({
      message: {
        ...baseMessage,
        attachments: [
          {
            type: "photo",
            photo: {
              sizes: [{ url: "https://u.com/a.jpg" }, { url: "https://u.com/b.jpg" }],
            },
          },
        ],
      },
    });
    expect(raw.attachments![0]!.url).toBe("https://u.com/b.jpg");
  });

  test("audio_message prefers link_ogg", () => {
    const raw = webhookMessageNewToRaw({
      message: {
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
      },
    });
    expect(raw.attachments![0]!.url).toBe("https://u.com/v.ogg");
  });

  test("audio_message falls back to link_mp3", () => {
    const raw = webhookMessageNewToRaw({
      message: {
        ...baseMessage,
        attachments: [
          { type: "audio_message", audio_message: { link_mp3: "https://u.com/v.mp3" } },
        ],
      },
    });
    expect(raw.attachments![0]!.url).toBe("https://u.com/v.mp3");
  });

  test("doc picks url", () => {
    const raw = webhookMessageNewToRaw({
      message: {
        ...baseMessage,
        attachments: [{ type: "doc", doc: { url: "https://u.com/x.pdf" } }],
      },
    });
    expect(raw.attachments![0]!.url).toBe("https://u.com/x.pdf");
  });

  test("unknown attachment types preserve type with undefined url", () => {
    const raw = webhookMessageNewToRaw({
      message: {
        ...baseMessage,
        attachments: [{ type: "sticker" }, { type: "wall" }],
      },
    });
    expect(raw.attachments).toEqual([
      { type: "sticker", url: undefined },
      { type: "wall", url: undefined },
    ]);
  });

  test("reply_message prefers conversation_message_id", () => {
    const raw = webhookMessageNewToRaw({
      message: {
        ...baseMessage,
        reply_message: { conversation_message_id: 5, id: 9999 },
      },
    });
    expect(raw.reply).toEqual({ conversation_message_id: 5, message_id: 9999 });
  });
});
