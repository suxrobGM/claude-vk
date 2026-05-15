import { describe, expect, test } from "bun:test";
import { parsePayloadVerdict } from "./verdict";

describe("parsePayloadVerdict", () => {
  test("accepts a well-formed allow payload", () => {
    const json = JSON.stringify({ a: "verdict", r: "abcde", b: "allow" });
    expect(parsePayloadVerdict(json)).toEqual({ behavior: "allow", request_id: "abcde" });
  });

  test("accepts a well-formed deny payload", () => {
    const json = JSON.stringify({ a: "verdict", r: "abcde", b: "deny" });
    expect(parsePayloadVerdict(json)).toEqual({ behavior: "deny", request_id: "abcde" });
  });

  test.each([
    [undefined, "missing"],
    ["", "empty"],
    ["not json", "invalid json"],
    [JSON.stringify(null), "null"],
    [JSON.stringify("string"), "string root"],
    [JSON.stringify({ a: "other", r: "abcde", b: "allow" }), "wrong action"],
    [JSON.stringify({ a: "verdict", r: "", b: "allow" }), "empty request_id"],
    [JSON.stringify({ a: "verdict", r: "abcde", b: "maybe" }), "invalid behavior"],
    [JSON.stringify({ a: "verdict", b: "allow" }), "missing request_id"],
    [JSON.stringify({ a: "verdict", r: 42, b: "allow" }), "non-string request_id"],
  ])("rejects %p (%s)", (input) => {
    expect(parsePayloadVerdict(input)).toBeNull();
  });
});
