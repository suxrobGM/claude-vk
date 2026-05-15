import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { PluginError, VkApiError } from "@/common/errors";
import { logger } from "@/common/logger";

/** Structural failure half of every MCP tool envelope. */
export interface ToolFailure {
  ok: false;
  code: string;
  message: string;
  vk_error_code?: number;
}

/**
 * Wraps a tool body with the shared envelope translation: known errors
 * collapse into structured `{ ok: false }` results; unknown errors are logged
 * and returned as `{ ok: false, code: "internal_error" }` rather than
 * propagated, so MCP never closes the connection on a tool exception.
 */
export async function runWithEnvelope<R extends { ok: true }>(
  tool: string,
  body: () => Promise<R>,
): Promise<R | ToolFailure> {
  try {
    return await body();
  } catch (err) {
    if (err instanceof VkApiError) {
      logger.warn({ tool, code: err.code, vk_error_code: err.vkErrorCode }, "vk error");
      return {
        ok: false,
        code: err.code,
        message: err.message,
        vk_error_code: err.vkErrorCode,
      };
    }
    if (err instanceof PluginError) {
      logger.warn({ tool, code: err.code }, "plugin error");
      return { ok: false, code: err.code, message: err.message };
    }
    logger.error({ tool, err }, "unexpected tool error");
    return {
      ok: false,
      code: "internal_error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Adapt a `{ ok }`-tagged result into the MCP `CallToolResult` envelope. */
export function toCallResult(result: { ok: boolean }): CallToolResult {
  return {
    structuredContent: result as unknown as { [k: string]: unknown },
    content: [{ type: "text", text: JSON.stringify(result) }],
    isError: !result.ok,
  };
}
