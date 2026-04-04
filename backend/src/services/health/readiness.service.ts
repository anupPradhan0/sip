import mongoose from "mongoose";
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
    redis: { configured: true; ok: boolean; latencyMs?: number; error?: string };
  };
  uptimeSeconds: number;
  timestamp: string;
}> {
  const mongo = await checkMongoPing();
  const ping = await pingRedis();
  const redis = {
    configured: true as const,
    ok: ping.ok,
    latencyMs: ping.latencyMs,
    ...(ping.error ? { error: ping.error } : {}),
  };

  const ok = mongo.ok && redis.ok;
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
