import { env } from "../../config/env";
import { getRedis } from "./redis.client";

/**
 * First delivery of this webhook identity: returns true.
 * Duplicate (SET NX failed): returns false — respond 200 without re-processing.
 */
export async function claimRecordingWebhookOnce(kind: "twilio" | "plivo" | "freeswitch", parts: string[]): Promise<boolean> {
  const redis = getRedis();
  const safe = parts.map((p) => encodeURIComponent(p)).join(":");
  const key = `${env.redisKeyPrefix}webhook:${kind}:${safe}`;
  const res = await redis.set(key, "1", "EX", env.redisWebhookDedupeTtlSec, "NX");
  return res === "OK";
}
