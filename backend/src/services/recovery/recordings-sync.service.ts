import fs from "node:fs/promises";
import path from "node:path";
import { CallModel } from "../../modules/calls/models/call.model";
import { RecordingModel } from "../../modules/calls/models/recording.model";

export interface RecordingsSyncOptions {
  recordingsDir: string;
  publicBaseUrl?: string;
  sweepIntervalMs: number;
  /** Only consider calls/recordings older than this to avoid racing active calls. */
  graceMs: number;
}

export class RecordingsSyncService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly opts: RecordingsSyncOptions) {}

  async runOnce(reason: "startup" | "interval" = "startup"): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const dir = path.resolve(this.opts.recordingsDir);
      const cutoff = new Date(Date.now() - this.opts.graceMs);

      let entries: string[] = [];
      try {
        entries = await fs.readdir(dir);
      } catch {
        return;
      }

      const wavs = entries.filter((f) => f.toLowerCase().endsWith(".wav"));
      for (const filename of wavs) {
        const uuid = filename.replace(/\.wav$/i, "");
        const filePath = path.join(dir, filename);

        // Skip very recent files (still being written)
        try {
          const st = await fs.stat(filePath);
          if (st.mtime > cutoff) continue;
          if (st.size <= 44) continue; // WAV header only or empty
        } catch {
          continue;
        }

        const call = await CallModel.findOne({ provider: "freeswitch", providerCallId: uuid });
        if (!call) continue;

        const retrievalUrl = this.opts.publicBaseUrl
          ? `${this.opts.publicBaseUrl.replace(/\/+$/, "")}/api/recordings/local/${uuid}`
          : `/api/recordings/local/${uuid}`;

        // Upsert recording metadata keyed by providerRecordingId (unique).
        await RecordingModel.updateOne(
          { providerRecordingId: uuid },
          {
            $setOnInsert: {
              callId: call._id,
              provider: "freeswitch",
              providerRecordingId: uuid,
            },
            $set: {
              status: "completed",
              filePath,
              retrievalUrl,
            },
          },
          { upsert: true },
        );
      }
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
        console.error("Recordings sync sweep failed:", err);
      });
    }, this.opts.sweepIntervalMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}

