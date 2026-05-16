import { singleton } from "tsyringe";

export interface RuntimeStatus {
  vkConnected: boolean;
  lastError: string | null;
  lastErrorAt: string | null;
  lastEventAt: string | null;
}

/**
 * Tiny in-process status sink the long-poll loop writes to and the
 * `/state` endpoint reads. Reset on every restart — the truth re-emerges
 * from the next inbound event.
 */
@singleton()
export class StatusRegistry {
  private status: RuntimeStatus = {
    vkConnected: false,
    lastError: null,
    lastErrorAt: null,
    lastEventAt: null,
  };

  /** Read the current runtime status snapshot. */
  get(): Readonly<RuntimeStatus> {
    return this.status;
  }

  /** Mark VK connected and clear any previously-recorded error. */
  markConnected(): void {
    this.status = {
      ...this.status,
      vkConnected: true,
      lastError: null,
      lastErrorAt: null,
    };
  }

  /** Mark VK disconnected and record the error string. */
  markDisconnected(error: string): void {
    this.status = {
      ...this.status,
      vkConnected: false,
      lastError: error,
      lastErrorAt: new Date().toISOString(),
    };
  }

  /** Stamp `lastEventAt` to now. Called on every successful inbound delivery. */
  markEvent(): void {
    this.status = { ...this.status, lastEventAt: new Date().toISOString() };
  }
}
