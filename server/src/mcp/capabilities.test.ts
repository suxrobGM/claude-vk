import { describe, expect, test } from "bun:test";
import { buildCapabilities } from "./capabilities";

describe("buildCapabilities", () => {
  test("advertises claude/channel and claude/channel/permission", () => {
    const caps = buildCapabilities();
    expect(caps.experimental).toEqual({
      "claude/channel": {},
      "claude/channel/permission": {},
    });
  });
});
