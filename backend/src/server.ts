import { app } from "./app";
import { connectDatabase } from "./config/database";
import { env } from "./config/env";
import { AddressInfo } from "node:net";

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
  await listenWithPortFallback(env.port);
}

bootstrap().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start server", error);
  process.exit(1);
});
