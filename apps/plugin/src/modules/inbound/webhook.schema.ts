import { t, type Static } from "elysia";

/**
 * VK Callback API envelope. Every event VK sends has the same outer shape; the
 * controller switches on `type` and the adapter narrows `object` per event.
 * `additionalProperties: true` because VK occasionally adds fields and the
 * webhook MUST stay 2xx — strict validation would force us to either reject
 * (forbidden by PRD §9.2) or invent error branches.
 */
export const WebhookEnvelopeSchema = t.Object(
  {
    type: t.String(),
    group_id: t.Optional(t.Integer()),
    secret: t.Optional(t.String()),
    event_id: t.Optional(t.String()),
    object: t.Optional(t.Unknown()),
    v: t.Optional(t.String()),
  },
  { additionalProperties: true },
);

export type WebhookEnvelope = Static<typeof WebhookEnvelopeSchema>;
