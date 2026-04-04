import dotenv from "dotenv";

dotenv.config();

const DEFAULT_PORT = 5000;
const DEFAULT_MONGO_URI = "mongodb://localhost:27017/sip-backend";

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? DEFAULT_PORT),
  mongoUri: process.env.MONGODB_URI ?? DEFAULT_MONGO_URI,
  /** When set, enables Redis-backed idempotency cache and webhook deduplication. */
  redisUrl: process.env.REDIS_URL?.trim() || undefined,
  redisKeyPrefix: process.env.REDIS_KEY_PREFIX?.trim() || "kulloo:",
  redisIdempotencyTtlSec: parseIntEnv("REDIS_IDEMPOTENCY_TTL_SEC", 86_400),
  redisWebhookDedupeTtlSec: parseIntEnv("REDIS_WEBHOOK_DEDUPE_TTL_SEC", 172_800),
  /** Optional override for absolute URLs (Plivo callbacks, recording links). */
  publicBaseUrl: process.env.PUBLIC_BASE_URL?.trim() || undefined,
  /** Target for Plivo Dial toward FreeSWITCH (SIP URI). */
  freeswitchSipUri: process.env.FREESWITCH_SIP_URI?.trim() || undefined,
  logLevel: process.env.LOG_LEVEL?.trim() || undefined,
  logFormat: process.env.LOG_FORMAT?.trim() || undefined,
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID?.trim() || undefined,
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN?.trim() || undefined,
  plivoAuthId: process.env.PLIVO_AUTH_ID?.trim() || undefined,
  plivoAuthToken: process.env.PLIVO_AUTH_TOKEN?.trim() || undefined,
  plivoAnswerUrl: process.env.PLIVO_ANSWER_URL?.trim() || undefined,
  plivoHangupUrl: process.env.PLIVO_HANGUP_URL?.trim() || undefined,
};

export function isRedisConfigured(): boolean {
  return Boolean(env.redisUrl && env.redisUrl.length > 0);
}
