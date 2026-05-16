import { Elysia } from "elysia";
import { container } from "@/common/di";
import { AccessService } from "./access.service";
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
} from "./schemas/http.schema";

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
  .get("/chats/:peerId", ({ params }) => access.getChat(params.peerId), {
    params: PeerIdParamSchema,
    response: ChatDetailResponseSchema,
  })
  .delete(
    "/chats/:peerId",
    async ({ params }) => {
      const removed = await access.removeChat(params.peerId);
      return { ok: true as const, ...removed };
    },
    { params: PeerIdParamSchema, response: RemoveChatResponseSchema },
  )
  .get("/chats/:peerId/senders", ({ params }) => access.listSenders(params.peerId), {
    params: PeerIdParamSchema,
    response: SendersListResponseSchema,
  })
  .post(
    "/chats/:peerId/senders",
    async ({ params, body, set }) => {
      const added = await access.addSender(params.peerId, body);
      set.headers["Location"] = `/access/chats/${params.peerId}/senders/${added.userId}`;
      set.status = 201;
      return { ok: true as const, ...added };
    },
    { params: PeerIdParamSchema, body: AddSenderBodySchema, response: AddSenderResponseSchema },
  )
  .delete(
    "/chats/:peerId/senders/:userId",
    async ({ params }) => {
      await access.removeSender(params.peerId, params.userId);
      return { ok: true as const };
    },
    { params: PeerIdSenderParamSchema, response: RemoveResponseSchema },
  )
  .put(
    "/chats/:peerId/mention-policy",
    async ({ params, body }) => {
      const updated = await access.setMentionPolicy(params.peerId, body.policy);
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
      set.headers["Location"] = `/access/chats/${added.peerId}`;
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
      summary: "Group-chat peerIds the gate dropped recently — copy into /vk:access group add.",
    },
  });
