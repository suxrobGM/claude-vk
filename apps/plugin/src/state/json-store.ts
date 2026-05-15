import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { ConfigError } from "@/common/errors";

export interface JsonStoreOptions<T> {
  /** Absolute path to the JSON file. Parent dir is created if missing. */
  path: string;
  /** TypeBox schema validated on initial load and after every `update`. */
  schema: TSchema;
  /** Written atomically the first time the file is created. */
  defaults: T;
}

/**
 * Generic atomic JSON file store. One instance owns one file. Reads are
 * synchronous against an in-memory cache; writes are serialized by an internal
 * promise chain so concurrent `update()` callers can't interleave. The factory
 * call MUST be followed by `await store.init()` before the first `get()` —
 * `JsonStore.create()` packages this for callers that prefer one expression.
 *
 * Validation failures throw `ConfigError` with a schema error path — the store
 * never silently resets user state.
 */
export class JsonStore<T> {
  private cache: T | undefined;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly opts: JsonStoreOptions<T>) {}

  /** Convenience: `new JsonStore(opts)` followed by `await init()`. */
  static async create<T>(opts: JsonStoreOptions<T>): Promise<JsonStore<T>> {
    const store = new JsonStore(opts);
    await store.init();
    return store;
  }

  /** Loads or creates the backing file. Must be awaited before any `get()`. */
  async init(): Promise<void> {
    await mkdir(dirname(this.opts.path), { recursive: true });
    this.cache = await this.loadOrInit();
  }

  /** Synchronous read against the in-memory cache. O(1). */
  get(): Readonly<T> {
    if (this.cache === undefined) {
      throw new Error(`JsonStore at ${this.opts.path} accessed before init()`);
    }
    return this.cache as Readonly<T>;
  }

  /**
   * Apply a structured-cloned draft mutation, validate, and atomically write.
   * Concurrent calls are serialized so writes can never interleave.
   */
  async update(fn: (draft: T) => T | void): Promise<void> {
    const next = this.writeChain.then(async () => {
      const current = this.get();
      const draft = structuredClone(current) as T;
      const result = fn(draft);
      const candidate = (result === undefined ? draft : result) as T;
      this.assertValid(candidate, "update");
      await this.atomicWrite(candidate);
      this.cache = candidate;
    });
    this.writeChain = next.catch(() => undefined);
    await next;
  }

  /** Re-read from disk, validate, swap the in-memory copy. Wired to `fs.watch` by `AccessStore`. */
  async reload(): Promise<void> {
    this.cache = await this.loadOrInit();
  }

  private async loadOrInit(): Promise<T> {
    let raw: string;
    try {
      raw = await readFile(this.opts.path, "utf8");
    } catch (err) {
      if (isNotFound(err)) {
        await this.atomicWrite(this.opts.defaults);
        return this.opts.defaults;
      }
      throw err;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new ConfigError(`Invalid JSON at ${this.opts.path}: ${(err as Error).message}`);
    }
    this.assertValid(parsed, "load");
    return parsed as T;
  }

  private assertValid(value: unknown, phase: "load" | "update"): void {
    if (Value.Check(this.opts.schema, value)) return;
    const errors = [...Value.Errors(this.opts.schema, value)]
      .map((e) => `  ${e.path.slice(1) || "<root>"}: ${e.message}`)
      .join("\n");
    throw new ConfigError(`Invalid state (${phase}) at ${this.opts.path}:\n${errors}`);
  }

  private async atomicWrite(value: unknown): Promise<void> {
    const tmp = `${this.opts.path}.tmp`;
    await writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
    await rename(tmp, this.opts.path);
    try {
      await chmod(this.opts.path, 0o600);
    } catch {
      // No-op on Windows.
    }
  }
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "ENOENT";
}
