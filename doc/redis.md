# Redis in Kulloo

Redis is **required** for the Kulloo API process: **`REDIS_URL`** must be set and Redis must answer **`PING`** before the HTTP server and ESL bootstrap continue. If either fails, startup exits with an error.

Redis does **not** replace Mongo as the system of record for calls, events, or recordings. It provides **idempotency acceleration**, **recording webhook deduplication**, readiness checks, and related metrics.

This document describes **why** Redis is used, **how** keys and TTLs work, **data flows**, and where to look in the codebase.

---

## 1. What Redis is used for

| Feature | Purpose | Mongo role (still authoritative) |
|--------|---------|----------------------------------|
| **Idempotency cache** | Faster repeat `POST /api/calls/outbound/hello` with the same `Idempotency-Key`: cache maps key → Mongo `Call._id` to skip an extra `findByIdempotencyKey` read when possible. | Same idempotency via unique `idempotencyKey` index if Redis is cold or evicted. |
| **Recording webhook dedupe** | If Twilio / Plivo / FreeSWITCH **retries** the same recording callback, `SET … NX` ensures the handler runs **once** per logical event; duplicates get **200** + `{ duplicate: true }` without double work. | Upserts may still converge; duplicate events / side effects are less likely with Redis. |
| **Readiness** | `GET /api/health` always includes a Redis **`PING`** in `checks.redis`; failure → overall readiness **503**. | N/A |
| **Metrics** | Counters for cache hits/misses and webhook skip count. | N/A |

---

## 2. Configuration

| Variable | Meaning |
|----------|---------|
| `REDIS_URL` | **Required.** Connection string, e.g. `redis://localhost:6379` or `redis://redis:6379` inside Docker. Missing or unreachable Redis prevents startup. |
| `REDIS_KEY_PREFIX` | Prefix for all keys (default `kulloo:`) so a shared Redis instance can host multiple apps. |
| `REDIS_IDEMPOTENCY_TTL_SEC` | Expiry for idempotency cache entries (default **86400** = 24h). |
| `REDIS_WEBHOOK_DEDUPE_TTL_SEC` | Expiry for webhook dedupe keys (default **172800** = 48h). |

Passwords and TLS are supported via standard Redis URLs (e.g. `rediss://` for TLS) as supported by **ioredis**.

---

## 3. Code layout

| Path | Role |
|------|------|
| [`backend/src/config/env.ts`](../backend/src/config/env.ts) | Reads `REDIS_*` env; `isRedisConfigured()`. |
| [`backend/src/services/redis/redis.client.ts`](../backend/src/services/redis/redis.client.ts) | Singleton **ioredis** client, `assertRedisAvailable()` (bootstrap), `pingRedis()`, `disconnectRedis()` (SIGTERM/SIGINT in `server.ts`). |
| [`backend/src/services/redis/idempotency-cache.service.ts`](../backend/src/services/redis/idempotency-cache.service.ts) | SHA-256 of `Idempotency-Key` → key `…idempo:<hex>`; `GET` / `SET` with TTL. |
| [`backend/src/services/redis/webhook-dedupe.service.ts`](../backend/src/services/redis/webhook-dedupe.service.ts) | `SET key 1 EX ttl NX` per webhook identity. |
| [`backend/src/modules/calls/services/call.service.ts`](../backend/src/modules/calls/services/call.service.ts) | `runOutboundHelloFlow`: cache read before Mongo; `setCachedCallId…` after Mongo hit or after `create`. |
| [`backend/src/modules/calls/controllers/call.controller.ts`](../backend/src/modules/calls/controllers/call.controller.ts) | Recording callbacks call `claimRecordingWebhookOnce` before ingestion. |
| [`backend/src/modules/health/routes/health.routes.ts`](../backend/src/modules/health/routes/health.routes.ts) | Readiness includes Redis `PING` via readiness service. |
| [`backend/src/services/observability/metrics.service.ts`](../backend/src/services/observability/metrics.service.ts) | `redisIdempotencyHits`, `redisIdempotencyMisses`, `webhookDedupeSkips`. |

---

## 4. Key shapes (logical)

All keys are prefixed with `REDIS_KEY_PREFIX` (default `kulloo:`).

| Pattern | Example | TTL |
|---------|---------|-----|
| Idempotency cache | `kulloo:idempo:<sha256(Idempotency-Key)>` | `REDIS_IDEMPOTENCY_TTL_SEC` |
| Twilio webhook | `kulloo:webhook:twilio:<encoded(CallSid)>:<encoded(RecordingSid)>` | `REDIS_WEBHOOK_DEDUPE_TTL_SEC` |
| Plivo webhook | `kulloo:webhook:plivo:<encoded(callUuid)>:<encoded(RecordingID)>` | same |
| FreeSWITCH webhook | `kulloo:webhook:freeswitch:<encoded(callUuid)>` | same |

Webhook segments are `encodeURIComponent`’d and joined with `:` to avoid delimiter collisions in values.

---

## 5. Data flow: outbound hello + idempotency cache

Mongo remains authoritative: the unique index on `idempotencyKey` still prevents duplicate calls if Redis is cold or evicted.

```mermaid
sequenceDiagram
  participant Client
  participant API as Express_API
  participant Redis
  participant Mongo as MongoDB

  Client->>API: POST outbound/hello + Idempotency-Key
  API->>Redis: GET idempo:sha256(key)
  alt Cache hit and Call matches key
    Redis-->>API: callId
    API->>Mongo: findById(callId)
    Mongo-->>API: Call document
    API-->>Client: 200 same call + recordings
  else Cache miss or invalid
    API->>Mongo: findByIdempotencyKey(key)
    alt Existing row
      Mongo-->>API: Call
      API->>Redis: SET idempo key callId EX ttl
      API-->>Client: 200
    else New call
      API->>Mongo: create Call
      API->>Redis: SET idempo key callId EX ttl
      API-->>Client: 200 after dial flow
    end
  end
```

**Metrics:** `redisIdempotencyHits` when a repeat request is satisfied from cache + Mongo; `redisIdempotencyMisses` once per request when the cache path did not return a usable hit (including first-time keys).

---

## 6. Data flow: recording webhooks (dedupe)

```mermaid
flowchart TD
  A[Provider POST callback] --> C[SET webhook:key EX ttl NX]
  C -->|OK first time| E[Run CallService ingest]
  C -->|null duplicate| D[200 duplicate true]
  D --> F[webhookDedupeSkips++]
  E --> G[200 success + data]
```

- **Twilio:** identity = `CallSid` + `RecordingSid`.
- **Plivo:** identity = query `callUuid` + body `RecordingID`.
- **FreeSWITCH:** identity = body `callUuid`.

Duplicate responses are still **HTTP 200** so providers stop retrying; they are **not** a substitute for verifying webhook authenticity (signatures, IP allowlists, etc.).

---

## 7. Health and process lifecycle

- **Startup:** After Mongo connects, `assertRedisAvailable()` requires `REDIS_URL` and a successful **`PING`**; otherwise the process exits.
- **`GET /api/health`**: `checks.redis` always has `configured: true` and a **`PING`** result. Failure → overall readiness **503**.
- **Shutdown:** `server.ts` registers `disconnectRedis()` on **SIGTERM** / **SIGINT** so the ioredis connection closes cleanly.

---

## 8. Docker and local development

| Compose file | Redis |
|--------------|--------|
| [`docker-compose.yml`](../docker-compose.yml) | `redis` service, host port **6379**. |
| [`docker-compose.server.yml`](../docker-compose.server.yml) | `redis` + `REDIS_URL=redis://redis:6379` on `api`. |
| [`docker-compose.redis.yml`](../docker-compose.redis.yml) | Redis-only stack for local use. |

Use **`redis://localhost:6379`** from the host when Redis is bound on localhost (dev or compose port publish).

**Port conflict:** Only one process should bind host **6379** at a time, or change the published port and adjust `REDIS_URL`.

---

## 9. Operational checklist

- Set **`REDIS_URL`** in every environment where the API runs; verify **`PING`** from the API host/container.
- Monitor **`GET /api/metrics`** for hit/miss/skip rates after traffic.
- Rely on **TTLs** so memory stays bounded; treat the idempotency layer as **best-effort** cache—Mongo indexes backstop idempotency.
- For production Redis exposed beyond localhost, use **password**, **network ACLs**, and **TLS** as appropriate.

---

## 10. Related documentation

- [api.md](./api.md) — HTTP surface, health, metrics.

---

*Redis: required dependency for idempotency cache, webhook dedupe, and readiness; MongoDB remains the source of truth for call state.*
