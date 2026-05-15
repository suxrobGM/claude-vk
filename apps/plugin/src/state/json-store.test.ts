import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { t } from "elysia";
import { ConfigError } from "@/common/errors";
import { JsonStore } from "./json-store";

const Schema = t.Object({
  count: t.Integer({ minimum: 0 }),
  label: t.Optional(t.String()),
});

type Shape = { count: number; label?: string };

let dir: string;
let path: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "json-store-"));
  path = join(dir, "state.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("JsonStore", () => {
  it("writes defaults when the file is missing", async () => {
    const store = await JsonStore.create<Shape>({
      path,
      schema: Schema,
      defaults: { count: 0 },
    });
    expect(store.get()).toEqual({ count: 0 });
    const onDisk = JSON.parse(await readFile(path, "utf8"));
    expect(onDisk).toEqual({ count: 0 });
  });

  it("loads existing valid file", async () => {
    await Bun.write(path, JSON.stringify({ count: 5, label: "x" }));
    const store = await JsonStore.create<Shape>({
      path,
      schema: Schema,
      defaults: { count: 0 },
    });
    expect(store.get()).toEqual({ count: 5, label: "x" });
  });

  it("throws ConfigError on invalid JSON", async () => {
    await Bun.write(path, "{not json");
    await expect(
      JsonStore.create<Shape>({ path, schema: Schema, defaults: { count: 0 } }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("throws ConfigError on schema violation at load", async () => {
    await Bun.write(path, JSON.stringify({ count: -1 }));
    await expect(
      JsonStore.create<Shape>({ path, schema: Schema, defaults: { count: 0 } }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("update mutates atomically and rejects invalid drafts", async () => {
    const store = await JsonStore.create<Shape>({
      path,
      schema: Schema,
      defaults: { count: 0 },
    });
    await store.update((d) => {
      d.count = 1;
      d.label = "hi";
    });
    expect(store.get()).toEqual({ count: 1, label: "hi" });
    const onDisk = JSON.parse(await readFile(path, "utf8"));
    expect(onDisk).toEqual({ count: 1, label: "hi" });

    await expect(
      store.update((d) => {
        d.count = -42;
      }),
    ).rejects.toBeInstanceOf(ConfigError);
    // Invalid update did not mutate the in-memory cache.
    expect(store.get()).toEqual({ count: 1, label: "hi" });
  });

  it("serializes concurrent updates", async () => {
    const store = await JsonStore.create<Shape>({
      path,
      schema: Schema,
      defaults: { count: 0 },
    });
    await Promise.all(
      Array.from({ length: 10 }, () =>
        store.update((d) => {
          d.count += 1;
        }),
      ),
    );
    expect(store.get().count).toBe(10);
  });

  it("throws when accessed before init()", () => {
    const store = new JsonStore<Shape>({ path, schema: Schema, defaults: { count: 0 } });
    expect(() => store.get()).toThrow(/before init/);
  });
});
