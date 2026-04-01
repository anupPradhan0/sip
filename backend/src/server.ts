import { app } from "./app";
import { connectDatabase } from "./config/database";
import { env } from "./config/env";
import { AddressInfo } from "node:net";
import { OrphanCallsRecoveryService } from "./services/recovery/orphan-calls-recovery.service";

function listenWithPortFallback(startPort: number, maxAttempts = 10): Promise<void> {
  return new Promise((resolve, reject) => {
    const tryListen = (port: number, attemptsLeft: number): void => {
      const server = app.listen(port);

      server.once("listening", () => {
        const address = server.address() as AddressInfo;
        const activePort = address.port;
        const baseUrl = `http://localhost:${activePort}`;

        // eslint-disable-next-line no-console
        console.log(`Server running on port ${activePort}`);
        // eslint-disable-next-line no-console
        console.log(`Server URL: ${baseUrl}`);
        resolve();
      });

      server.once("error", (error: NodeJS.ErrnoException) => {
        server.close();

        if (error.code === "EADDRINUSE" && attemptsLeft > 1) {
          // eslint-disable-next-line no-console
          console.warn(`Port ${port} is in use, trying ${port + 1}...`);
          tryListen(port + 1, attemptsLeft - 1);
          return;
        }

        reject(error);
      });
    };

    tryListen(startPort, maxAttempts);
  });
}

async function bootstrap(): Promise<void> {
  await connectDatabase();
  
  const eslOutboundPort = parseInt(process.env.ESL_OUTBOUND_PORT || "3200", 10);
  const recordingsDir = process.env.RECORDINGS_DIR;
  const orphanGraceMs = Number(process.env.ORPHAN_GRACE_MS ?? 120000);
  const orphanSweepIntervalMs = Number(process.env.ORPHAN_SWEEP_INTERVAL_MS ?? 60000);

  console.log(`Starting ESL outbound server on port ${eslOutboundPort}`);

  // ESL outbound server - FreeSWITCH connects TO this
  // No need to connect TO FreeSWITCH first in outbound mode
  const { EslCallHandlerService: EslHandler } = await import("./services/freeswitch/esl-call-handler.service");
  
  const eslServer = new EslHandler({
    port: eslOutboundPort,
    host: "0.0.0.0",
    recordingsDir,
    mediaServer: null, // Not needed for ESL outbound mode
  });

  // Crash/restart recovery: finalize orphan calls from previous runs.
  const recovery = new OrphanCallsRecoveryService({
    graceMs: orphanGraceMs,
    sweepIntervalMs: orphanSweepIntervalMs,
    getActiveProviderCallIds: () => (eslServer as any).getActiveProviderCallIds?.() ?? new Set<string>(),
  });
  await recovery.runOnce("startup");
  recovery.start();

  await eslServer.listen();
  console.log(`ESL outbound server listening on port ${eslOutboundPort}`);
  console.log("FreeSWITCH will connect to this server when calls arrive");

  await listenWithPortFallback(env.port);
}

bootstrap().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start server", error);
  process.exit(1);
});
