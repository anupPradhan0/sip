import { CallRepository } from "../../modules/calls/repositories/call.repository";
import { logger } from "../../utils/logger";

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

const STATUSES_TO_FAIL = NON_TERMINAL_STATUSES.filter((s) => s !== "hangup");

export class OrphanCallsRecoveryService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly callRepository = new CallRepository();

  constructor(private readonly opts: OrphanRecoveryOptions) {}

  async runOnce(reason: "startup" | "interval" = "startup"): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const cutoff = new Date(Date.now() - this.opts.graceMs);
      const activeSet =
        reason === "interval" ? this.opts.getActiveProviderCallIds?.() : undefined;

      await this.callRepository.sweepStaleHangupToCompleted(cutoff, activeSet);
      await this.callRepository.sweepStaleNonTerminalToFailed(cutoff, activeSet, STATUSES_TO_FAIL);
    } finally {
      this.running = false;
    }
  }

  start(): void {
    if (this.timer) return;
    if (this.opts.sweepIntervalMs <= 0) return;
    this.timer = setInterval(() => {
      this.runOnce("interval").catch((err: unknown) => {
        logger.error("orphan_call_recovery_sweep_failed", { err });
      });
    }, this.opts.sweepIntervalMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}
