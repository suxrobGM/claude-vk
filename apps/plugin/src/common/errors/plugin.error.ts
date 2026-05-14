/**
 * Errors raised inside MCP tool handlers and the inbound pipeline.
 * Translated into structured `{ ok: false, code, message }` results before
 * returning to Claude — never let raw stack traces leak through MCP.
 */
export class PluginError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "PluginError";
  }
}

export class ConfigError extends PluginError {
  constructor(message: string, cause?: unknown) {
    super("config_invalid", message, cause);
    this.name = "ConfigError";
  }
}

export class VkApiError extends PluginError {
  constructor(
    public readonly vkErrorCode: number,
    message: string,
    cause?: unknown,
  ) {
    super(`vk_api_${String(vkErrorCode)}`, message, cause);
    this.name = "VkApiError";
  }
}

export class AccessDeniedError extends PluginError {
  constructor(reason: string) {
    super("access_denied", reason);
    this.name = "AccessDeniedError";
  }
}
