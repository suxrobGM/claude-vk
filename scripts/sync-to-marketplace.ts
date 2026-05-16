#!/usr/bin/env bun
/**
 * Copies the built plugin artifacts into the `claude-plugins` marketplace repo
 * so it can be committed and pushed there. Run after `bun run build`.
 *
 *   MARKETPLACE_VK_PATH=/path/to/claude-plugins/plugins/vk bun scripts/sync-to-marketplace.ts
 *
 * Default target: `../claude-plugins/plugins/vk` relative to this repo's root.
 */
import { cpSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..");
const DEFAULT_TARGET = resolve(REPO_ROOT, "..", "claude-plugins", "plugins", "vk");
const BUNDLE_PATH = "dist/server.js";

const ITEMS: Array<[from: string, to: string]> = [
  [BUNDLE_PATH, BUNDLE_PATH],
  [".claude-plugin/plugin.json", ".claude-plugin/plugin.json"],
  [".mcp.json", ".mcp.json"],
  ["skills", "skills"],
  ["ACCESS.md", "ACCESS.md"],
];

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

function preflight(target: string): void {
  if (!existsSync(join(REPO_ROOT, BUNDLE_PATH))) {
    fail(`${BUNDLE_PATH} not found — run \`bun run build\` first`);
  }
  if (!existsSync(target)) {
    fail(
      `target directory ${target} does not exist — clone the marketplace repo or set MARKETPLACE_VK_PATH`,
    );
  }
}

function syncItem(target: string, from: string, to: string): void {
  const src = join(REPO_ROOT, from);
  const dst = join(target, to);
  if (!existsSync(src)) {
    fail(`source ${src} missing`);
  }

  mkdirSync(dirname(dst), { recursive: true });
  cpSync(src, dst, { recursive: true, force: true });

  const kind = statSync(src).isDirectory() ? "dir " : "file";
  console.log(`  ${kind}  ${from} -> ${to}`);
}

function printSummary(target: string): void {
  const size = statSync(join(target, BUNDLE_PATH)).size;
  const sizeMb = (size / 1024 / 1024).toFixed(2);
  console.log(`\nsynced to ${target}`);
  console.log(`bundle size: ${sizeMb} MB`);
  console.log(`\nnext: cd ${target.replace(/\\/g, "/")} && git status`);
}

function main(): void {
  // The marketplace repo is expected to already be cloned and the target directory
  const target = resolve(process.env.MARKETPLACE_VK_PATH ?? DEFAULT_TARGET);
  preflight(target);

  for (const [from, to] of ITEMS) {
    syncItem(target, from, to);
  }

  printSummary(target);
}

main();
