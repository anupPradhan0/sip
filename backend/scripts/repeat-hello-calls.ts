import axios from "axios";

type Mode = "outbound-sip" | "outbound-pstn";

interface CliConfig {
  mode: Mode;
  count: number;
  delayMs: number;
  baseUrl: string;
  from: string;
  to: string;
}

function parseArgs(): CliConfig {
  const mode = (process.argv[2] as Mode) || "outbound-sip";
  const count = Number(process.argv[3] ?? 10);
  const delayMs = Number(process.argv[4] ?? 300);

  const baseUrl = process.env.HELLO_CALL_BASE_URL ?? "http://localhost:5000";
  const from = process.env.HELLO_CALL_FROM ?? "sip:1001@local";
  const to = process.env.HELLO_CALL_TO ?? "sip:hello@local";

  if (!["outbound-sip", "outbound-pstn"].includes(mode)) {
    throw new Error("Mode must be one of: outbound-sip | outbound-pstn");
  }

  return { mode, count, delayMs, baseUrl, from, to };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function run(): Promise<void> {
  const config = parseArgs();
  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < config.count; i += 1) {
    try {
      const provider = config.mode === "outbound-pstn"
        ? (process.env.HELLO_CALL_PSTN_PROVIDER ?? "plivo")
        : "sip-local";

      const { data } = await axios.post<{
        data?: { call?: { _id?: string; status?: string }; recordings?: unknown[] };
      }>(
        `${config.baseUrl}/api/calls/outbound/hello`,
        {
          from: config.from,
          to: config.to,
          provider,
          recordingEnabled: true,
        },
        {
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": `hello-${Date.now()}-${i}`,
          },
        },
      );

      if (!data || typeof data !== "object") {
        throw new Error("Empty response body");
      }

      successCount += 1;
      const callId = data?.data?.call?._id ?? "unknown";
      const status = data?.data?.call?.status ?? "unknown";
      const recordingCount = data?.data?.recordings?.length ?? 0;
      // eslint-disable-next-line no-console
      console.log(
        `[${i + 1}/${config.count}] success callId=${callId} status=${status} recordings=${recordingCount}`,
      );
    } catch (error) {
      failureCount += 1;
      // eslint-disable-next-line no-console
      console.error(`[${i + 1}/${config.count}] failed`, error);
    }

    await sleep(config.delayMs);
  }

  const successRate = ((successCount / config.count) * 100).toFixed(2);
  // eslint-disable-next-line no-console
  console.log(
    `Run finished: success=${successCount} failure=${failureCount} successRate=${successRate}%`,
  );
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("repeat-hello-calls failed:", error);
  process.exit(1);
});
