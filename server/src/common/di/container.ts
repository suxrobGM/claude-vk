import "reflect-metadata";
import { container } from "tsyringe";

let bootstrapped = false;

/**
 * Wires non-class singletons into the tsyringe root container. Idempotent —
 * safe to call from both the entrypoint and from tests that reset the
 * container between cases.
 *
 * Class services use `@injectable()` / `@singleton()` and resolve by their
 * constructor reference, so they do not need explicit registration here.
 * Cross-cutting helpers like `logger` are imported directly from their
 * module rather than going through the container — DI is reserved for
 * dependencies that genuinely vary at runtime or in tests.
 */
export function bootstrapContainer(): void {
  if (bootstrapped) return;
  // Reserved for future value registrations (config snapshot, etc.).
  bootstrapped = true;
}

/**
 * Test helper: clears all tsyringe registrations and the bootstrap guard so
 * the next `bootstrapContainer()` re-registers cleanly.
 */
export function resetContainer(): void {
  container.reset();
  bootstrapped = false;
}

export { container };
