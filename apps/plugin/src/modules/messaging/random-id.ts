let counter = 0;

/**
 * Returns a per-process monotonic id for VK's `messages.send.random_id`. VK
 * dedupes identical ids in a short window — this guards against MCP-reconnect
 * double-sends. Resets on process restart; collisions across restarts are
 * vanishingly unlikely because `Date.now()` floors at ms.
 */
export function nextRandomId(): number {
  counter = (counter + 1) % 1000;
  return Date.now() * 1000 + counter;
}
