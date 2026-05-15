import { t, type Static } from "elysia";

/**
 * Cross-module schema building blocks. Anything reused in two or more
 * `*.schema.ts` files should live here so its shape and description stay
 * in one place.
 */

/** Numeric id encoded as a string in URL paths (VK peer/user ids can be negative). */
export const NumericIdStringSchema = t.String({
  pattern: "^-?\\d+$",
  description: "Signed 64-bit integer encoded as a string.",
});

/** Standard `{ ok: true }` response for mutations whose only return value is success. */
export const OkResponseSchema = t.Object({
  ok: t.Literal(true),
});

/**
 * Simple `{ error: <code> }` body used by REST endpoints to surface known
 * failure reasons. The code is a stable kebab-case identifier the caller
 * can branch on; humans get the same string as a message.
 */
export const SimpleErrorBodySchema = t.Object({
  error: t.String({ description: "Stable failure code (kebab-case)." }),
});

/** `T | null` for response fields that may genuinely be absent. */
export const NullableString = t.Union([t.String(), t.Null()]);

export type SimpleErrorBody = Static<typeof SimpleErrorBodySchema>;
export type OkResponse = Static<typeof OkResponseSchema>;
