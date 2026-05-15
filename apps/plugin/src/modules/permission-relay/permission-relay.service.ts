import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { singleton } from "tsyringe";
import { logger } from "@/common/logger";
import type { InboundMessage } from "@/modules/inbound/inbound.types";
import type { ChannelNotifier } from "@/modules/inbound/notifier";
import { MessagingService } from "@/modules/messaging/messaging.service";
import { buildVerdictKeyboard } from "./keyboard";
import type { PermissionRequestParams } from "./permission-relay.schema";
import { parsePayloadVerdict } from "./verdict";

const PENDING_TTL_MS = 10 * 60 * 1000;

interface PendingRequest {
  request_id: string;
  from_id: number;
  peer_id: number;
  tool_name: string;
  created_at: number;
}

interface DmActivator {
  peer_id: number;
  from_id: number;
}

/**
 * MCP permission_request ↔ VK DM bridge. Outbound: DM the last activator with
 * Allow/Deny buttons. Inbound: button payload emits the verdict notification
 * and short-circuits the forwarding pipeline. State is in-memory.
 */
@singleton()
export class PermissionRelayService {
  private mcp: McpServer | null = null;
  private notifier: ChannelNotifier | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private lastDmActivator: DmActivator | null = null;

  constructor(private readonly messaging: MessagingService) {}

  setMcp(mcp: McpServer): void {
    this.mcp = mcp;
  }

  setNotifier(notifier: ChannelNotifier): void {
    this.notifier = notifier;
  }

  /** Remember the most recent DM peer so a permission prompt can be routed. */
  recordLastDmActivator(peer_id: number, from_id: number): void {
    this.lastDmActivator = { peer_id, from_id };
  }

  /**
   * Entry point for the MCP notification handler. Routes the request to the
   * last-known DM peer; if none is on file, surfaces a `<channel>` warning so
   * Claude can fall back to the terminal prompt and the user knows why VK was
   * skipped.
   */
  async handleRequest(params: PermissionRequestParams): Promise<void> {
    this.sweepExpired();

    const activator = this.lastDmActivator;
    if (!activator) {
      logger.warn(
        { request_id: params.request_id },
        "permission relay: no DM activator on file; cannot route",
      );
      await this.notifier?.warn(
        `permission relay: no recent DM on file; cannot route request ${params.request_id} — using terminal prompt`,
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

    this.pending.set(params.request_id, {
      request_id: params.request_id,
      from_id: activator.from_id,
      peer_id: activator.peer_id,
      tool_name: params.tool_name,
      created_at: Date.now(),
    });
    logger.info(
      { peer_id: activator.peer_id, request_id: params.request_id },
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

    const pending = this.pending.get(verdict.request_id);
    if (!pending) {
      // Unknown/expired request — still consume the click.
      return true;
    }

    if (msg.from_id !== pending.from_id) {
      await this.notifier?.warn(
        `permission verdict for ${verdict.request_id} from non-originating user ignored`,
      );
      this.pending.delete(verdict.request_id);
      return true;
    }

    const mcp = this.mcp;
    if (!mcp) {
      logger.error(
        { request_id: verdict.request_id },
        "permission relay: mcp handle missing; cannot emit verdict",
      );
      return true;
    }

    try {
      await mcp.server.notification({
        method: "notifications/claude/channel/permission",
        params: { request_id: verdict.request_id, behavior: verdict.behavior },
      });
      logger.info(
        { request_id: verdict.request_id, behavior: verdict.behavior },
        "permission verdict relayed to Claude",
      );
    } catch (err) {
      logger.error({ err, request_id: verdict.request_id }, "failed to emit permission verdict");
    } finally {
      this.pending.delete(verdict.request_id);
    }
    return true;
  }

  private sweepExpired(): void {
    const cutoff = Date.now() - PENDING_TTL_MS;
    for (const [id, p] of this.pending) {
      if (p.created_at < cutoff) this.pending.delete(id);
    }
  }
}

function formatPrompt(params: PermissionRequestParams): string {
  const body = params.description?.trim();
  const detail = body ? `\n   "${body}"` : "";
  return `🔒 Claude wants to run ${params.tool_name}:${detail}\n\nTap Allow or Deny below.`;
}
