import { chmodSync, readFileSync } from "node:fs";
import { Value } from "@sinclair/typebox/value";
import { parse } from "dotenv";
import { t, type Static } from "elysia";
import { envPath } from "@/state/paths";

const EnvSchema = t.Object({
  VK_TOKEN: t.Optional(t.String({ minLength: 1 })),
  VK_COMMUNITY_ID: t.Optional(t.String({ minLength: 1 })),
  VK_COMMUNITY_SCREEN_NAME: t.Optional(t.String()),
  VK_TRANSPORT: t.Optional(
    t.Union([t.Literal("longpoll"), t.Literal("callback")], { default: "longpoll" }),
  ),
  VK_PORT: t.Optional(t.String({ default: "6060", pattern: "^[0-9]+$" })),
  VK_HTTP_BIND: t.Optional(t.String({ default: "127.0.0.1" })),
  VK_WEBHOOK_SECRET: t.Optional(t.String()),
  VK_WEBHOOK_CONFIRMATION: t.Optional(t.String({ minLength: 1 })),
  VK_LOCALE: t.Optional(t.String({ default: "en" })),
  VK_PERMISSION_RELAY: t.Optional(
    t.Union([t.Literal("true"), t.Literal("false")], { default: "false" }),
  ),
  VK_STATE_DIR: t.Optional(t.String()),

  LOG_LEVEL: t.Optional(t.String({ default: "info" })),
  NODE_ENV: t.Optional(
    t.Union([t.Literal("development"), t.Literal("production"), t.Literal("test")]),
  ),
});

export type Env = Static<typeof EnvSchema>;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace NodeJS {
    interface ProcessEnv extends Env {}
  }
}

/**
 * Reads ~/.claude/channels/vk/.env via dotenv. Pure: does not mutate
 * process.env. Re-callable — M1 watcher invokes this on every .env change.
 */
export function readEnvFile(): Record<string, string> {
  try {
    chmodSync(envPath, 0o600);
  } catch {
    // No-op on Windows or if file does not exist yet.
  }
  let raw: Buffer;
  try {
    raw = readFileSync(envPath);
  } catch {
    return {};
  }
  return parse(raw);
}

/**
 * Merge the .env file under process.env (shell wins), validate against the
 * schema, write schema-declared defaults back to process.env so consumers can
 * read `process.env.VK_PORT!` without repeating `?? "6060"` at every call site.
 *
 * Designed to be re-callable: M1 watcher invokes this on every .env change
 * before calling `config.reload()`.
 *
 * Throws on validation failure to prevent startup with invalid configuration.
 */
export function validateEnv(): void {
  const fileEnv = readEnvFile();
  const merged: Record<string, string | undefined> = { ...fileEnv };
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) merged[key] = value;
  }

  const converted = Value.Convert(EnvSchema, merged) as Record<string, unknown>;
  const defaults = Value.Default(EnvSchema, converted) as Record<string, unknown>;
  const errors = [...Value.Errors(EnvSchema, defaults)];

  if (errors.length) {
    const messages = errors.map((e) => `  ${e.path.slice(1)}: ${e.message}`).join("\n");
    throw new Error(`Environment validation failed:\n${messages}`);
  }

  for (const [key, value] of Object.entries(defaults)) {
    if (value !== undefined && !process.env[key]) {
      process.env[key] = String(value);
    }
  }
}
