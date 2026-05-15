import { singleton } from "tsyringe";

export interface RuntimeStatus {
  vk_connected: boolean;
  last_error: string | null;
  last_error_at: string | null;
  last_event_at: string | null;
}

/**
 * Tiny in-process status sink the long-poll loop writes to and the
 * `/admin/state` endpoint reads. Reset on every restart — the truth re-emerges
 * from the next inbound event.
 */
@singleton()
export class StatusRegistry {
  private status: RuntimeStatus = {
    vk_connected: false,
    last_error: null,
    last_error_at: null,
    last_event_at: null,
  };

  /** Read the current runtime status snapshot. */
  get(): Readonly<RuntimeStatus> {
    return this.status;
  }

  /** Mark VK connected and clear any previously-recorded error. */
  markConnected(): void {
    this.status = {
      ...this.status,
      vk_connected: true,
      last_error: null,
      last_error_at: null,
    };
  }

  /** Mark VK disconnected and record the error string. */
  markDisconnected(error: string): void {
    this.status = {
      ...this.status,
      vk_connected: false,
      last_error: error,
      last_error_at: new Date().toISOString(),
    };
  }

  /** Stamp `last_event_at` to now. Called on every successful inbound delivery. */
  markEvent(): void {
    this.status = { ...this.status, last_event_at: new Date().toISOString() };
  }
}
