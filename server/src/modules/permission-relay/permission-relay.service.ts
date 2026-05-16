import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { singleton } from "tsyringe";
import { logger } from "@/common/logger";
import { AccessStore } from "@/modules/access/access.store";
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
    this.sweepExpired();

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

  private sweepExpired(): void {
    const cutoff = Date.now() - PENDING_TTL_MS;
    for (const [id, p] of this.pending) {
      if (p.created_at < cutoff) {
        this.pending.delete(id);
      }
    }
  }
}

function formatPrompt(params: PermissionRequestParams): string {
  const body = params.description?.trim();
  const detail = body ? `\n   "${body}"` : "";
  return `🔒 Claude wants to run ${params.tool_name}:${detail}\n\nTap Allow or Deny below.`;
}
