import { describe, expect, it } from "bun:test";
import { chunkText } from "./chunk-text";

describe("chunkText", () => {
  it("returns empty array for empty input", () => {
    expect(chunkText("")).toEqual([]);
  });

  it("returns single chunk when under the cap", () => {
    expect(chunkText("hello", 10)).toEqual(["hello"]);
  });

  it("returns single chunk at exactly the cap", () => {
    const text = "a".repeat(10);
    expect(chunkText(text, 10)).toEqual([text]);
  });

  it("splits text exceeding the cap into multiple chunks", () => {
    const text = "a".repeat(25);
    const out = chunkText(text, 10);
    expect(out).toHaveLength(3);
    expect(out.join("")).toBe(text);
  });

  it("prefers whitespace boundaries within lookback window", () => {
    const text = "word1 word2 word3 word4 word5"; // 29 chars
    const out = chunkText(text, 12);
    for (const chunk of out) {
      expect(chunk.length).toBeLessThanOrEqual(12);
      expect(chunk.startsWith(" ")).toBe(false);
      expect(chunk.endsWith(" ")).toBe(false);
    }
    expect(out.join(" ")).toBe(text);
  });

  it("falls back to hard split when no whitespace is reachable", () => {
    const text = "a".repeat(50);
    const out = chunkText(text, 16);
    expect(out.every((c) => c.length <= 16)).toBe(true);
    expect(out.join("")).toBe(text);
  });

  it("handles boundary at exactly cap+1", () => {
    const text = "a".repeat(11);
    const out = chunkText(text, 10);
    expect(out).toHaveLength(2);
    expect(out.join("")).toBe(text);
  });
});
