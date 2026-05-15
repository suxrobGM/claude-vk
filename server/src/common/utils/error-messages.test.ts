import { describe, expect, it } from "bun:test";
import { humanizeError } from "./error-messages";

describe("humanizeError", () => {
  it("returns a hint for every mapped vk_api_* code", () => {
    const mapped = [5, 6, 9, 100, 901, 917];
    for (const code of mapped) {
      const hint = humanizeError(`vk_api_${String(code)}`, code);
      expect(hint).not.toBeNull();
      expect(hint!.length).toBeGreaterThan(0);
    }
  });

  it("returns a hint for non-vk plugin codes", () => {
    expect(humanizeError("config_invalid")).not.toBeNull();
    expect(humanizeError("access_denied")).not.toBeNull();
  });

  it("returns null for unmapped vk_api_* codes", () => {
    expect(humanizeError("vk_api_42", 42)).toBeNull();
  });

  it("returns null for unknown plugin codes", () => {
    expect(humanizeError("internal_error")).toBeNull();
    expect(humanizeError("totally_unknown")).toBeNull();
  });

  it("returns null when vk_api_* has no numeric code", () => {
    expect(humanizeError("vk_api_5")).toBeNull();
  });
});
