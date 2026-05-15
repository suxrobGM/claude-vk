import { describe, expect, test } from "bun:test";
import { GROUP_CHAT_PEER_OFFSET, isGroupChat } from "./peer";

describe("isGroupChat", () => {
  test("treats a regular user_id as DM", () => {
    expect(isGroupChat(123_456)).toBe(false);
    expect(isGroupChat(0)).toBe(false);
  });

  test("treats peer_id at the 2e9 boundary as a group chat", () => {
    expect(isGroupChat(GROUP_CHAT_PEER_OFFSET)).toBe(true);
    expect(isGroupChat(GROUP_CHAT_PEER_OFFSET + 42)).toBe(true);
  });

  test("treats peer_id just below the boundary as DM", () => {
    expect(isGroupChat(GROUP_CHAT_PEER_OFFSET - 1)).toBe(false);
  });
});
