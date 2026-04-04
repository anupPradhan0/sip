import Redis from "ioredis";
import { env, isRedisConfigured } from "../../config/env";
import { logger } from "../../utils/logger";

let client: Redis | null = null;

/**
 * Returns the shared Redis client. Requires `REDIS_URL` and successful startup `assertRedisAvailable()`.
 */
export function getRedis(): Redis {
  if (!isRedisConfigured()) {
    throw new Error("REDIS_URL is required but not set");
  }
  if (!client) {
    client = new Redis(env.redisUrl as string, {
      maxRetriesPerRequest: 3,
      retryStrategy(times: number): number | null {
        if (times > 4) {
          return null;
        }
        return Math.min(times * 200, 2000);
      },
    });
    client.on("error", (err: Error) => {
      logger.error("redis_client_error", { err: err.message });
    });
    client.on("connect", () => {
      logger.info("redis_connected");
    });
  }
  return client;
}

export async function pingRedis(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  if (!isRedisConfigured()) {
    return { ok: false, error: "REDIS_URL is not set" };
  }
  try {
    const redis = getRedis();
    const started = Date.now();
    await redis.ping();
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Fails fast if Redis is not configured or does not respond to PING. Call during bootstrap after Mongo. */
export async function assertRedisAvailable(): Promise<void> {
  if (!isRedisConfigured()) {
    const message =
      "REDIS_URL is required. Set it (e.g. redis://localhost:6379 or redis://redis:6379 in Docker).";
    logger.error("bootstrap_redis_required", { message });
    throw new Error(message);
  }
  const ping = await pingRedis();
  if (!ping.ok) {
    const message = `Redis is unreachable: ${ping.error ?? "unknown"}`;
    logger.error("bootstrap_redis_unreachable", { error: ping.error });
    throw new Error(message);
  }
  logger.info("bootstrap_redis_ok", { latencyMs: ping.latencyMs });
}

export async function disconnectRedis(): Promise<void> {
  if (!client) {
    return;
  }
  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
  client = null;
}
