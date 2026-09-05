import type { McpServer } from "@modelcontextprotocol/server";
import { singleton } from "tsyringe";
import { logger } from "@/common/logger";
import { AccessStore } from "@/modules/access/access.store";
import type { InboundMessage } from "@/modules/inbound/inbound.types";
import type { ChannelNotifier } from "@/modules/inbound/notifier";
import { MessagingService } from "@/modules/messaging/messaging.service";
import { buildVerdictKeyboard } from "./keyboard";
import type { PermissionRequestParams } from "./permission-relay.schema";
import { parsePayloadVerdict } from "./verdict";

const PENDING_TTL_MIN = 10;
const PENDING_TTL_MS = PENDING_TTL_MIN * 60_000;

interface PendingRequest {
  from_id: number;
  peer_id: number;
  tool_name: string;
  timer: ReturnType<typeof setTimeout>;
}

interface DmActivator {
  peer_id: number;
  from_id: number;
}

/**
 * MCP permission_request ↔ VK DM bridge. Outbound: DM the first paired DM in
 * `access.json` with Allow/Deny buttons. Inbound: button payload emits the
 * verdict notification and short-circuits the forwarding pipeline.
 */
@singleton()
export class PermissionRelayService {
  private mcp: McpServer | null = null;
  private notifier: ChannelNotifier | null = null;
  private readonly pending = new Map<string, PendingRequest>();

  constructor(
    private readonly messaging: MessagingService,
    private readonly access: AccessStore,
  ) {}

  setMcp(mcp: McpServer): void {
    this.mcp = mcp;
  }

  setNotifier(notifier: ChannelNotifier): void {
    this.notifier = notifier;
  }

  /**
   * Entry point for the MCP notification handler. Routes to the first paired
   * DM in `access.json`; if none, surfaces a `<channel>` warning so Claude
   * falls back to the terminal prompt.
   */
  async handleRequest(params: PermissionRequestParams): Promise<void> {
    const activator = this.findFirstDmActivator();
    if (!activator) {
      logger.warn(
        { request_id: params.request_id },
        "permission relay: no paired DM in access.json; cannot route",
      );
      await this.notifier?.warn(
        `permission relay: no paired DM in access.json; cannot route request ${params.request_id} — pair a DM via /vk:access, falling back to terminal prompt`,
      );
      return;
    }

    const text = formatPrompt(params);
    const keyboard = buildVerdictKeyboard(params.request_id);
    const result = await this.messaging.send({ peer_id: activator.peer_id, text }, { keyboard });
    if (!result.ok) {
      logger.warn(
        { peer_id: activator.peer_id, request_id: params.request_id, code: result.code },
        "permission relay: failed to DM prompt",
      );
      await this.notifier?.warn(
        `permission relay: failed to DM prompt for ${params.request_id} (${result.code}) — using terminal prompt`,
      );
      return;
    }

    // A re-issued request_id must not leave the previous timer armed.
    this.forget(params.request_id);

    const requestId = params.request_id;
    const timer = setTimeout(() => {
      void this.expire(requestId);
    }, PENDING_TTL_MS);
    // Unref'd so an outstanding prompt never keeps `bun test` (or a shutdown) alive.
    timer.unref();

    this.pending.set(requestId, {
      from_id: activator.from_id,
      peer_id: activator.peer_id,
      tool_name: params.tool_name,
      timer,
    });
    logger.info(
      { peer_id: activator.peer_id, request_id: requestId },
      "permission relay: prompt DM sent",
    );
  }

  /**
   * Inbound hook. Returns `true` iff the message was a verdict button click —
   * the caller must short-circuit the pipeline so the bare "Allow"/"Deny"
   * label doesn't reach Claude (PRD §15.1).
   */
  async tryResolveVerdict(msg: InboundMessage): Promise<boolean> {
    const verdict = parsePayloadVerdict(msg.payload);
    if (!verdict) return false;

    // Group chats: ignore the verdict (too easy to social-engineer) but still
    // consume so the label doesn't broadcast to Claude. In practice the
    // keyboard is only ever sent in DMs, so this is belt-and-suspenders.
    if (msg.is_group_chat) {
      await this.notifier?.warn(
        "permission verdict received in group chat ignored — verdicts must come from DMs",
      );
      return true;
    }

    const pending = this.forget(verdict.request_id);
    if (!pending) {
      // Unknown/expired request — still consume the click.
      return true;
    }

    if (msg.from_id !== pending.from_id) {
      await this.notifier?.warn(
        `permission verdict for ${verdict.request_id} from non-originating user ignored`,
      );
      return true;
    }

    await this.emitVerdict(verdict.request_id, verdict.behavior);
    return true;
  }

  /** Auto-deny an unanswered prompt so a lapsed request can't leave the session waiting. */
  private async expire(requestId: string): Promise<void> {
    const pending = this.forget(requestId);
    if (!pending) return;

    logger.warn(
      { request_id: requestId, tool_name: pending.tool_name },
      "permission relay: prompt unanswered; auto-denying to unblock the session",
    );
    await this.emitVerdict(requestId, "deny");
    await this.notifier?.warn(
      `permission prompt ${requestId} (${pending.tool_name}) went unanswered for ${String(PENDING_TTL_MIN)}m and was auto-denied`,
    );
    const result = await this.messaging.send({
      peer_id: pending.peer_id,
      text: `⌛ No answer for ${pending.tool_name} — auto-denied so the bot can keep going.`,
    });
    if (!result.ok) {
      logger.warn(
        { peer_id: pending.peer_id, request_id: requestId, code: result.code },
        "permission relay: failed to DM timeout notice",
      );
    }
  }

  /** Emit the verdict notification for `requestId`. */
  private async emitVerdict(requestId: string, behavior: "allow" | "deny"): Promise<void> {
    const mcp = this.mcp;
    if (!mcp) {
      logger.error(
        { request_id: requestId },
        "permission relay: mcp handle missing; cannot emit verdict",
      );
      return;
    }

    try {
      await mcp.server.notification({
        method: "notifications/claude/channel/permission",
        params: { request_id: requestId, behavior },
      });
      logger.info({ request_id: requestId, behavior }, "permission verdict relayed to Claude");
    } catch (err) {
      logger.error({ err, request_id: requestId }, "failed to emit permission verdict");
    }
  }

  /** Drop a pending request, cancel its auto-deny timer, and return what was removed. */
  private forget(requestId: string): PendingRequest | null {
    const pending = this.pending.get(requestId);
    if (!pending) return null;
    clearTimeout(pending.timer);
    this.pending.delete(requestId);
    return pending;
  }

  /**
   * First `kind: "dm"` entry in `access.json` (insertion order). VK DM peer_id
   * equals the user's id, so `from_id = peer_id` — that's what verdict-sender
   * validation expects.
   */
  private findFirstDmActivator(): DmActivator | null {
    const chats = this.access.get().chats;
    for (const [key, entry] of Object.entries(chats)) {
      if (entry.kind !== "dm") {
        continue;
      }

      const peerId = Number(key);
      if (!Number.isFinite(peerId) || peerId <= 0) {
        continue;
      }
      return { peer_id: peerId, from_id: peerId };
    }
    return null;
  }
}

function formatPrompt(params: PermissionRequestParams): string {
  const body = params.description?.trim();
  const detail = body ? `\n   "${body}"` : "";
  return `🔒 Claude wants to run ${params.tool_name}:${detail}\n\nTap Allow or Deny below.`;
}
