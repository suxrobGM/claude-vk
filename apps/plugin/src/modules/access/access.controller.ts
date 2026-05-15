import { Elysia } from "elysia";
import { container } from "@/common/di";
import {
  AddSenderBodySchema,
  AddSenderResponseSchema,
  ChatDetailResponseSchema,
  ChatsListResponseSchema,
  ConsumePairingBodySchema,
  ConsumePairingOkSchema,
  PeerIdParamSchema,
  PeerIdSenderParamSchema,
  PeerTypeParamSchema,
  PendingPairingsResponseSchema,
  PoliciesResponseSchema,
  RemoveChatResponseSchema,
  RemoveResponseSchema,
  SendersListResponseSchema,
  SetPolicyBodySchema,
  SetPolicyResponseSchema,
} from "./access.schema";
import { AccessService } from "./access.service";

const access = container.resolve(AccessService);

/**
 * REST surface for `/admin/access/*`. Schemas live in {@link ./access.schema},
 * logic in {@link AccessService}. Errors thrown by the service (subclasses of
 * `HttpError`) are mapped to HTTP responses by the global error handler.
 */
export const accessController = new Elysia({
  name: "access",
  prefix: "/admin/access",
  tags: ["Admin"],
})
  .get("/chats", () => ({ chats: access.listChats() }), {
    response: ChatsListResponseSchema,
    detail: { summary: "List allowed chats." },
  })
  .get("/chats/:peer_id", ({ params }) => access.getChat(params.peer_id), {
    params: PeerIdParamSchema,
    response: ChatDetailResponseSchema,
  })
  .delete(
    "/chats/:peer_id",
    async ({ params }) => {
      const removed = await access.removeChat(params.peer_id);
      return { ok: true as const, ...removed };
    },
    { params: PeerIdParamSchema, response: RemoveChatResponseSchema },
  )
  .get("/chats/:peer_id/senders", ({ params }) => access.listSenders(params.peer_id), {
    params: PeerIdParamSchema,
    response: SendersListResponseSchema,
  })
  .post(
    "/chats/:peer_id/senders",
    async ({ params, body, set }) => {
      const added = await access.addSender(params.peer_id, body);
      set.headers["Location"] = `/admin/access/chats/${params.peer_id}/senders/${added.user_id}`;
      set.status = 201;
      return { ok: true as const, ...added };
    },
    { params: PeerIdParamSchema, body: AddSenderBodySchema, response: AddSenderResponseSchema },
  )
  .delete(
    "/chats/:peer_id/senders/:user_id",
    async ({ params }) => {
      await access.removeSender(params.peer_id, params.user_id);
      return { ok: true as const };
    },
    { params: PeerIdSenderParamSchema, response: RemoveResponseSchema },
  )
  .get("/policies", () => access.getPolicies(), {
    response: PoliciesResponseSchema,
    detail: { summary: "Read current DM + group_chat policies." },
  })
  .put(
    "/policies/:peer_type",
    async ({ params, body }) => {
      const updated = await access.setPolicy(params.peer_type, body.policy);
      return { ok: true as const, ...updated };
    },
    {
      params: PeerTypeParamSchema,
      body: SetPolicyBodySchema,
      response: SetPolicyResponseSchema,
    },
  )
  .post(
    "/pairings",
    async ({ body }) => {
      const result = await access.consumePairing(body.code);
      return { ok: true as const, ...result };
    },
    { body: ConsumePairingBodySchema, response: ConsumePairingOkSchema },
  )
  .get("/pairings", () => ({ pending: access.listPending() }), {
    response: PendingPairingsResponseSchema,
  });
