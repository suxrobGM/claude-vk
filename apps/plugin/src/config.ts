import { validateEnv } from "@/env";

export interface Config {
  port: number;
  vkToken?: string;
}

let validated = false;

function ensureValidated(): void {
  if (validated) return;
  validateEnv();
  validated = true;
}

/**
 * Returns a fresh snapshot of effective configuration built from `process.env`
 * at call time. The first call validates the schema and writes declared defaults
 * back to `process.env`; subsequent calls just re-read. Tests can mutate
 * `process.env` between calls and the next `current()` picks the new value up.
 */
export function current(): Config {
  ensureValidated();
  return {
    port: Number(process.env.VK_PORT!),
    vkToken: process.env.VK_TOKEN,
  };
}
