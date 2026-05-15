import { afterAll, describe, expect, test } from "bun:test";
import { reload } from "@/config";
import { buildCapabilities } from "./capabilities";

const originalValue = process.env.VK_PERMISSION_RELAY;

afterAll(() => {
  if (originalValue === undefined) {
    delete process.env.VK_PERMISSION_RELAY;
  } else {
    process.env.VK_PERMISSION_RELAY = originalValue;
  }
  reload();
});

describe("buildCapabilities", () => {
  test("permission relay off → only claude/channel", () => {
    process.env.VK_PERMISSION_RELAY = "false";
    reload();
    const caps = buildCapabilities();
    expect(caps.experimental).toEqual({ "claude/channel": {} });
  });

  test("permission relay on → both keys present", () => {
    process.env.VK_PERMISSION_RELAY = "true";
    reload();
    const caps = buildCapabilities();
    expect(caps.experimental).toEqual({
      "claude/channel": {},
      "claude/channel/permission": {},
    });
  });
});
