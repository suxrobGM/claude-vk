import { readFileSync } from "node:fs";
import { Value } from "@sinclair/typebox/value";
import { parse } from "dotenv";
import { t, type Static } from "elysia";
import { envPath } from "@/state/paths";

const EnvSchema = t.Object({
  VK_TOKEN: t.Optional(t.String({ minLength: 1 })),
  PORT: t.Optional(t.String({ default: "6060", pattern: "^[0-9]+$" })),

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
 * Merge `~/.claude/channels/vk/.env` under `process.env` (shell wins),
 * validate the schema, and write declared defaults back so consumers can read
 * `process.env.PORT!` directly. Throws on validation failure.
 */
export function validateEnv(): void {
  const fileEnv = readEnvFile();
  for (const [key, value] of Object.entries(fileEnv)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }

  const converted = Value.Convert(EnvSchema, { ...process.env }) as Record<string, unknown>;
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

function readEnvFile(): Record<string, string> {
  try {
    return parse(readFileSync(envPath, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}
