/** Resolves after `ms` milliseconds. The single canonical sleep used across the plugin. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
