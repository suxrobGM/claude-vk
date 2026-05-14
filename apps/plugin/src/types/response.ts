import { t, type Static } from "elysia";

/**
 * Error response schema for the admin API (matches ogstack shape so a future
 * shared client can consume both surfaces interchangeably).
 */
export const ErrorResponseSchema = t.Object({
  code: t.String(),
  message: t.String(),
  details: t.Optional(t.Unknown()),
});

export const MessageResponseSchema = t.Object({
  message: t.String(),
});

export type ErrorResponse = Static<typeof ErrorResponseSchema>;
export type MessageResponse = Static<typeof MessageResponseSchema>;

export const HttpErrorResponses = {
  400: t.Object(
    { code: t.String(), message: t.String(), details: t.Optional(t.Unknown()) },
    { description: "Bad Request" },
  ),
  401: t.Object(
    { code: t.String(), message: t.String(), details: t.Optional(t.Unknown()) },
    { description: "Unauthorized" },
  ),
  403: t.Object(
    { code: t.String(), message: t.String(), details: t.Optional(t.Unknown()) },
    { description: "Forbidden" },
  ),
  404: t.Object(
    { code: t.String(), message: t.String(), details: t.Optional(t.Unknown()) },
    { description: "Not Found" },
  ),
  409: t.Object(
    { code: t.String(), message: t.String(), details: t.Optional(t.Unknown()) },
    { description: "Conflict" },
  ),
};
