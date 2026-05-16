import { Elysia } from "elysia";
import { container } from "@/common/di";
import {
  AddGroupBodySchema,
  AddGroupResponseSchema,
  AddSenderBodySchema,
  AddSenderResponseSchema,
  ChatDetailResponseSchema,
  ChatsListResponseSchema,
  ConsumePairingBodySchema,
  ConsumePairingOkSchema,
  PeerIdParamSchema,
  PeerIdSenderParamSchema,
  PendingGroupsResponseSchema,
  PendingPairingsResponseSchema,
  PoliciesResponseSchema,
  RemoveChatResponseSchema,
  RemoveResponseSchema,
  SendersListResponseSchema,
  SetMentionPolicyBodySchema,
  SetMentionPolicyResponseSchema,
  SetPolicyBodySchema,
  SetPolicyResponseSchema,
} from "./access.schema";
import { AccessService } from "./access.service";

const access = container.resolve(AccessService);

/**
 * REST surface for `/access/*`. Schemas live in {@link ./access.schema},
 * logic in {@link AccessService}. Errors thrown by the service (subclasses of
 * `HttpError`) are mapped to HTTP responses by the global error handler.
 */
export const accessController = new Elysia({
  name: "access",
  prefix: "/access",
  tags: ["Access"],
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
      set.headers["Location"] = `/access/chats/${params.peer_id}/senders/${added.user_id}`;
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
  .put(
    "/chats/:peer_id/mention-policy",
    async ({ params, body }) => {
      const updated = await access.setMentionPolicy(params.peer_id, body.policy);
      return { ok: true as const, ...updated };
    },
    {
      params: PeerIdParamSchema,
      body: SetMentionPolicyBodySchema,
      response: SetMentionPolicyResponseSchema,
    },
  )
  .post(
    "/groups",
    async ({ body, set }) => {
      const added = await access.addGroup(body);
      set.headers["Location"] = `/access/chats/${added.peer_id}`;
      set.status = 201;
      return { ok: true as const, ...added };
    },
    { body: AddGroupBodySchema, response: AddGroupResponseSchema },
  )
  .get("/policy", () => access.getPolicies(), {
    response: PoliciesResponseSchema,
    detail: { summary: "Read current DM policy." },
  })
  .put(
    "/policy",
    async ({ body }) => {
      const updated = await access.setDmPolicy(body.policy);
      return { ok: true as const, ...updated };
    },
    { body: SetPolicyBodySchema, response: SetPolicyResponseSchema },
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
  })
  .get("/groups/pending", () => ({ pending: access.listPendingGroups() }), {
    response: PendingGroupsResponseSchema,
    detail: {
      summary: "Group-chat peer_ids the gate dropped recently — copy into /vk:access group add.",
    },
  });
