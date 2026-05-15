import { watch } from "node:fs";
import { singleton } from "tsyringe";
import { PluginError } from "@/common/errors";
import { logger } from "@/common/logger";
import { JsonStore } from "@/state/json-store";
import { accessPath } from "@/state/paths";
import { ACCESS_FILE_DEFAULTS, AccessFileSchema, type AccessFile } from "./access.schema";

const RELOAD_DEBOUNCE_MS = 100;

/**
 * Loads, mutates, and watches `access.json`. The underlying `JsonStore`
 * handles atomic writes + schema validation; this class adds `fs.watch` so
 * hand-edits to the file are picked up without a restart. Watch events fire
 * multiple times per save (rename + change), so we debounce.
 */
@singleton()
export class AccessStore {
  private store: JsonStore<AccessFile> | null = null;
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;

  async init(): Promise<void> {
    if (this.store) return;
    this.store = await JsonStore.create<AccessFile>({
      path: accessPath,
      schema: AccessFileSchema,
      defaults: ACCESS_FILE_DEFAULTS,
    });
    this.startWatcher();
  }

  /** Current in-memory snapshot. O(1). */
  get(): Readonly<AccessFile> {
    return this.getStore().get();
  }

  /** Apply a structured-cloned mutation, validate, atomically persist. */
  update(fn: (draft: AccessFile) => AccessFile | void): Promise<void> {
    return this.getStore().update(fn);
  }

  private getStore(): JsonStore<AccessFile> {
    if (!this.store) {
      throw new PluginError("store_not_initialized", "AccessStore accessed before init()");
    }
    return this.store;
  }

  private startWatcher(): void {
    try {
      watch(accessPath, { persistent: false }, () => this.scheduleReload());
    } catch (err) {
      logger.warn({ err }, "access.json watch failed; hand-edits will not hot-reload");
    }
  }

  private scheduleReload(): void {
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(async () => {
      this.reloadTimer = null;
      try {
        await this.getStore().reload();
        logger.info("access.json reloaded from disk");
      } catch (err) {
        logger.warn({ err }, "access.json reload failed; previous state retained");
      }
    }, RELOAD_DEBOUNCE_MS);
  }
}
