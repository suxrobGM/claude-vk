import { chmodSync, readFileSync } from "node:fs";
import { Value } from "@sinclair/typebox/value";
import { parse } from "dotenv";
import { t, type Static } from "elysia";
import { envPath } from "@/state/paths";

const EnvSchema = t.Object({
  VK_TOKEN: t.Optional(t.String({ minLength: 1 })),
  VK_PORT: t.Optional(t.String({ default: "6060", pattern: "^[0-9]+$" })),

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
 * Merge the .env file under process.env (shell wins), validate against the
 * schema, write schema-declared defaults back to process.env so consumers can
 * read `process.env.VK_PORT!` without repeating `?? "6060"` at every call site.
 *
 * Throws on validation failure to prevent startup with invalid configuration.
 */
export function validateEnv(): void {
  const fileEnv = parse(envPath);
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
