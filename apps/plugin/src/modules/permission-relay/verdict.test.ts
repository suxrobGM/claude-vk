import { describe, expect, test } from "bun:test";
import { parseVerdict } from "./verdict";

describe("parseVerdict", () => {
  test.each([
    ["yes abcde", "allow", "abcde"],
    ["y abcde", "allow", "abcde"],
    ["YES ABCDE", "allow", "abcde"],
    ["Y AbCdE", "allow", "abcde"],
    ["no abcde", "deny", "abcde"],
    ["n abcde", "deny", "abcde"],
    ["NO ABCDE", "deny", "abcde"],
    ["  yes abcde  ", "allow", "abcde"],
  ])("accepts %p", (input, behavior, request_id) => {
    expect(parseVerdict(input)).toEqual({
      behavior: behavior as "allow" | "deny",
      request_id,
    });
  });

  test.each([
    ["yes abcdl"], // contains 'l'
    ["yes ABCDL"],
    ["yes abcd"], // too short
    ["yes abcdef"], // too long
    ["yes abcde extra"], // trailing junk
    ["extra yes abcde"], // leading junk
    ["maybe abcde"],
    [""],
    ["yes"],
    ["abcde"],
    ["yes  abcde"], // not rejected — actually allowed (multiple spaces)
  ])("rejects %p", (input) => {
    // The "multiple spaces" case is actually accepted because \s+ matches 2+ spaces.
    // Strip that case here — it's not a rejection.
    if (input === "yes  abcde") {
      expect(parseVerdict(input)).toEqual({ behavior: "allow", request_id: "abcde" });
      return;
    }
    expect(parseVerdict(input)).toBeNull();
  });
});
