import { CallModel } from "../../modules/calls/models/call.model";

export interface OrphanRecoveryOptions {
  graceMs: number;
  sweepIntervalMs: number;
  /**
   * A function returning providerCallIds currently active in this process.
   * These calls will be excluded from periodic sweeps.
   */
  getActiveProviderCallIds?: () => ReadonlySet<string>;
}

type NonTerminalStatus =
  | "received"
  | "initiated"
  | "answered"
  | "connected"
  | "played"
  | "recording_started"
  | "hangup";

const NON_TERMINAL_STATUSES: NonTerminalStatus[] = [
  "received",
  "initiated",
  "answered",
  "connected",
  "played",
  "recording_started",
  "hangup",
];

export class OrphanCallsRecoveryService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly opts: OrphanRecoveryOptions) {}

  async runOnce(reason: "startup" | "interval" = "startup"): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const cutoff = new Date(Date.now() - this.opts.graceMs);
      const activeSet =
        reason === "interval" ? this.opts.getActiveProviderCallIds?.() : undefined;

      // Mark stale hangup calls as completed.
      await CallModel.updateMany(
        {
          status: "hangup",
          updatedAt: { $lt: cutoff },
          ...(activeSet && activeSet.size
            ? { providerCallId: { $nin: Array.from(activeSet) } }
            : {}),
        },
        {
          $set: {
            status: "completed",
            "timestamps.completedAt": new Date(),
          },
        },
      );

      // Mark all other stale non-terminal calls as failed.
      await CallModel.updateMany(
        {
          status: { $in: NON_TERMINAL_STATUSES.filter((s) => s !== "hangup") },
          updatedAt: { $lt: cutoff },
          ...(activeSet && activeSet.size
            ? { providerCallId: { $nin: Array.from(activeSet) } }
            : {}),
        },
        {
          $set: {
            status: "failed",
            "timestamps.failedAt": new Date(),
            lastError: "orphaned after backend restart",
          },
        },
      );
    } finally {
      this.running = false;
    }
  }

  start(): void {
    if (this.timer) return;
    if (this.opts.sweepIntervalMs <= 0) return;
    this.timer = setInterval(() => {
      this.runOnce("interval").catch((err) => {
        // eslint-disable-next-line no-console
        console.error("Orphan call recovery sweep failed:", err);
      });
    }, this.opts.sweepIntervalMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}

