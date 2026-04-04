import { createHash } from "node:crypto";
import { Types } from "mongoose";
import { env } from "../../config/env";
import { getRedis } from "./redis.client";

function redisKeyForIdempotency(idempotencyKey: string): string {
  const digest = createHash("sha256").update(idempotencyKey, "utf8").digest("hex");
  return `${env.redisKeyPrefix}idempo:${digest}`;
}

/** Returns cached Mongo call id when present and valid. */
export async function peekCachedCallIdForIdempotencyKey(idempotencyKey: string): Promise<string | undefined> {
  const redis = getRedis();
  const raw = await redis.get(redisKeyForIdempotency(idempotencyKey));
  if (!raw || !Types.ObjectId.isValid(raw)) {
    return undefined;
  }
  return raw;
}

export async function setCachedCallIdForIdempotencyKey(idempotencyKey: string, callId: string): Promise<void> {
  const redis = getRedis();
  await redis.set(redisKeyForIdempotency(idempotencyKey), callId, "EX", env.redisIdempotencyTtlSec);
}
