import { Elysia } from "elysia";
import { container } from "@/common/di";
import { WebhookEnvelopeSchema } from "./webhook.schema";
import { WebhookService } from "./webhook.service";

const webhook = container.resolve(WebhookService);

/**
 * VK Callback API receiver. Mounted only when `VK_TRANSPORT=callback` (see
 * `app.ts`). All dispatching lives in {@link WebhookService}; this controller
 * is the HTTP edge.
 */
export const inboundController = new Elysia({
  name: "inbound",
  prefix: "/webhook",
  tags: ["Inbound"],
}).post("/vk", ({ body }) => webhook.handle(body), {
  body: WebhookEnvelopeSchema,
  detail: { summary: "VK Callback API receiver." },
});
