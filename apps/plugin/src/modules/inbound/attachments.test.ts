import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { AttachmentService, isAllowedHost } from "./attachments";

const realFetch = globalThis.fetch;
const fetched: string[] = [];
let nextResponse: { status: number; body: Uint8Array } | Error = {
  status: 200,
  body: new Uint8Array(),
};

let work: string;

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), "attachments-"));
  process.env.VK_STATE_DIR = work;
  fetched.length = 0;
  nextResponse = { status: 200, body: new Uint8Array() };
  globalThis.fetch = ((url: string) => {
    fetched.push(url);
    if (nextResponse instanceof Error) return Promise.reject(nextResponse);
    const { status, body } = nextResponse;
    return Promise.resolve(new Response(body, { status }));
  }) as typeof fetch;
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  await rm(work, { recursive: true, force: true });
  delete process.env.VK_STATE_DIR;
});

describe("isAllowedHost", () => {
  it("accepts VK CDN hosts", () => {
    expect(isAllowedHost("https://sun9.userapi.com/abc.jpg")).toBe(true);
    expect(isAllowedHost("https://psv4.userapi.com/abc.ogg")).toBe(true);
    expect(isAllowedHost("https://vk.com/foo")).toBe(true);
    expect(isAllowedHost("https://i.vk.me/abc")).toBe(true);
  });

  it("rejects unrelated hosts", () => {
    expect(isAllowedHost("https://evil.example.com/abc.jpg")).toBe(false);
    expect(isAllowedHost("file:///etc/passwd")).toBe(false);
    expect(isAllowedHost("not-a-url")).toBe(false);
  });
});

describe("AttachmentService.downloadAll", () => {
  it("returns input unchanged when there are no attachments", async () => {
    const svc = new AttachmentService();
    const out = await svc.downloadAll([], 1, 1);
    expect(out).toEqual([]);
    expect(fetched).toEqual([]);
  });

  it("skips attachments without an allowed-host url", async () => {
    const svc = new AttachmentService();
    const out = await svc.downloadAll([{ type: "wall", url: "https://example.com/x" }], 1, 1);
    expect(fetched).toEqual([]);
    expect(out[0]!.local_path).toBeUndefined();
  });

  it("downloads and writes files for allowed hosts", async () => {
    nextResponse = { status: 200, body: new TextEncoder().encode("hello") };
    const svc = new AttachmentService();
    const out = await svc.downloadAll(
      [{ type: "photo", url: "https://sun9.userapi.com/file.jpg?cs=1" }],
      999,
      888,
    );
    expect(fetched).toEqual(["https://sun9.userapi.com/file.jpg?cs=1"]);
    expect(out).toHaveLength(1);
    expect(out[0]!.local_path).toBeDefined();
    const written = await readFile(out[0]!.local_path!);
    expect(new TextDecoder().decode(written)).toBe("hello");
  });

  it("does not throw on fetch failure; leaves local_path unset", async () => {
    nextResponse = new Error("nope");
    const svc = new AttachmentService();
    const out = await svc.downloadAll(
      [{ type: "photo", url: "https://sun9.userapi.com/x.jpg" }],
      1,
      1,
    );
    expect(out[0]!.local_path).toBeUndefined();
  });
});
