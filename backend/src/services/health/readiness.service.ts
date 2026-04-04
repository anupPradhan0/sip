import mongoose from "mongoose";
import { isRedisConfigured } from "../../config/env";
import { pingRedis } from "../redis/redis.client";

export async function checkMongoPing(): Promise<{
  ok: boolean;
  latencyMs?: number;
  error?: string;
}> {
  try {
    if (mongoose.connection.readyState !== 1) {
      return {
        ok: false,
        error: `Not connected (readyState=${mongoose.connection.readyState})`,
      };
    }

    const db = mongoose.connection.db;
    if (!db) {
      return { ok: false, error: "No database handle" };
    }

    const started = Date.now();
    await db.admin().command({ ping: 1 });
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getReadinessPayload(): Promise<{
  ok: boolean;
  status: string;
  message: string;
  checks: {
    mongodb: Awaited<ReturnType<typeof checkMongoPing>>;
    redis:
      | { configured: boolean; ok: boolean; latencyMs?: number; error?: string }
      | { configured: false; ok: true };
  };
  uptimeSeconds: number;
  timestamp: string;
}> {
  const mongo = await checkMongoPing();

  let redis: {
    configured: boolean;
    ok: boolean;
    latencyMs?: number;
    error?: string;
  };
  if (isRedisConfigured()) {
    const ping = await pingRedis();
    redis = {
      configured: true,
      ok: ping.ok,
      latencyMs: ping.latencyMs,
      ...(ping.error ? { error: ping.error } : {}),
    };
  } else {
    redis = { configured: false, ok: true };
  }

  const ok = mongo.ok && (!redis.configured || redis.ok);
  const status = ok ? "ok" : "degraded";

  return {
    ok,
    status,
    message: ok ? "Backend is healthy" : "Backend is up but dependencies failed checks",
    checks: {
      mongodb: mongo,
      redis,
    },
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  };
}
