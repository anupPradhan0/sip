# Kulloo backend — complete folder and file reference

This document reflects **every directory** and **every file** under repository path **`backend/`** as of the last refresh.

**Exception:** The **`node_modules/`** directory is listed as a single entry. Its **inner** files are third-party packages (thousands of files) and are **not** listed one-by-one.

**Generated output:** **`dist/`** is produced by `pnpm build` (TypeScript → JavaScript). If it does not exist yet, it is noted below as optional.

Paths are relative to **`backend/`** unless noted.

---

## 1. Top-level directories

| Path | Role |
|------|------|
| **`backend/`** | Root of the Node/Express API package. |
| **`node_modules/`** | pnpm-installed dependencies. Created by `pnpm install`. Do not edit by hand; not enumerated file-by-file in this doc. |
| **`scripts/`** | Standalone TypeScript scripts (e.g. hello-call soak tests). |
| **`src/`** | Application source code. |

---

## 2. Where to put new code (folder responsibilities)

Use this when you add a file so it lands next to similar code. **Rule of thumb:** keep **HTTP**, **business rules**, and **database access** in separate layers; put **cross-cutting infra** under `src/services/<area>/`.

### 2.1 By kind of code

| You are adding… | Put it in… | Notes |
|------------------|------------|--------|
| Express **middleware** (auth, rate limit, extra logging, etc.) | **`src/middlewares/`** | Export a `(req, res, next)` function; register in **`app.ts`** (or a router) with `app.use(...)`. |
| **Pure helpers** (string/date math, parsing plain objects, shared constants) with **no** Express `Request`, Mongoose, or Redis | **`src/utils/`** | If it only needs Zod + `ApiError`, **`zod-validate.ts`** pattern is fine. |
| **New environment variables** or config shape | **`src/config/env.ts`** (or a new small file under **`src/config/`** if it is large/specialized) | **Do not** read `process.env` scattered in services; extend **`env`** and import it. |
| **TypeScript-only** declarations (`.d.ts`, module augmentation) | **`src/types/`** | No runtime code. |
| **HTTP handlers** for a feature (parse input, call service, set status/body) | **`src/modules/<feature>/controllers/`** | Keep them thin: no business rules, no direct Mongoose calls. |
| **Business logic** (orchestration, rules, calling external APIs for the domain) | **`src/modules/<feature>/services/`** | Call **repositories** (and **adapters**) instead of `Model` directly. |
| **Mongoose queries** (`find`, `create`, `update`, aggregates) | **`src/modules/<feature>/repositories/`** | One repository per aggregate is typical (e.g. `call.repository.ts`). |
| **Mongoose schema + `model()`** | **`src/modules/<feature>/models/`** | Schemas only. |
| **Zod schemas** for request/query/body | **`src/modules/<feature>/validators/`** | Export types with `z.infer<typeof …>` when useful. |
| **`Router` + path → controller** wiring | **`src/modules/<feature>/routes/`** | Only wiring; then mount the router from **`src/routes/index.ts`** under `/api/...`. |
| **Provider-specific outbound** (Plivo/Twilio/…) for **calls** | **`src/modules/calls/adapters/`** | Keeps telephony SDKs out of the core **`call.service`**. |
| **Plivo (or similar) routes on the root app** (not under `/api`) | **`src/modules/calls/routes/`** (e.g. **`plivo.webhooks.ts`**) + register from **`app.ts`** | Same pattern for other carriers if needed: small `registerXRoutes(app)`. |
| **FreeSWITCH / ESL / MRF** connection and media control | **`src/services/freeswitch/`** | Persist call state through **`CallService`**, not raw repositories from ESL. |
| **Redis client + Redis-backed helpers** | **`src/services/redis/`** | |
| **Background recovery / sync jobs** | **`src/services/recovery/`** | Use **repositories** or domain services; avoid `Model.updateMany` in the job file if the query belongs in a repository. |
| **Metrics counters / snapshots** | **`src/services/observability/`** | Expose via **`src/routes/metrics.routes.ts`** or a tiny controller. |
| **Readiness logic** (DB ping, dependency checks) without Express | **`src/services/health/`** | HTTP surface stays in **`src/modules/health/`**. |
| **Small cross-feature API aggregator** | **`src/routes/index.ts`** | Only composes routers; **do not** grow business logic here. |
| **Process bootstrap** (listen ports, start ESL, recovery timers) | **`src/server.ts`** | Avoid new features here; call into services. |
| **Global Express app** (middleware stack, mount routers) | **`src/app.ts`** | Prefer extracting new behavior into middleware or modules. |
| **One-off CLI / soak tests** | **`scripts/`** | Not part of the running API bundle unless imported from **`server`**. |

### 2.2 New feature module (e.g. `billing`)

1. Create **`src/modules/billing/`** with the usual folders: **`routes/`**, **`controllers/`**, **`services/`**, **`repositories/`**, **`models/`**, **`validators/`** (omit any you do not need yet).  
2. Add **`billing.routes.ts`** and export a `Router`.  
3. In **`src/routes/index.ts`**, `apiRouter.use("/billing", billingRouter)`.  
4. If the feature needs **new collections**, add **models** + **repositories** first, then **services**, then **controllers** + **routes**.

### 2.3 Quick “if unsure” checklist

- **Touches `req` / `res`?** → **controller** (or **middleware** if it wraps many routes).  
- **Decides *what* should happen (policy, branching, “if email exists throw 409”)?** → **service**.  
- **Builds a Mongo filter or calls `Model`?** → **repository**.  
- **Shared across modules and stateless?** → **utils**.  
- **Runs between request and handler?** → **middlewares**.  
- **Infrastructure (FS/ESL/Redis/metrics), not one product feature?** → **`src/services/<area>/`**.

---

## 3. Full directory tree (all folders + all project files)

```
backend/
├── node_modules/                    # third-party deps (see §1 top-level)
├── scripts/
│   └── repeat-hello-calls.ts
├── Dockerfile
├── .dockerignore
├── .env                             # local secrets — do not commit
├── .env.example
├── package.json
├── pnpm-lock.yaml
├── README.md
├── tsconfig.json
└── src/
    ├── app.ts
    ├── server.ts
    ├── config/
    │   ├── database.ts
    │   └── env.ts
    ├── middlewares/
    │   ├── correlation.middleware.ts
    │   └── error.middleware.ts
    ├── modules/
    │   ├── calls/
    │   │   ├── adapters/
    │   │   │   └── telephony.adapter.ts
    │   │   ├── controllers/
    │   │   │   ├── call.controller.ts
    │   │   │   └── plivo-answer.controller.ts
    │   │   ├── models/
    │   │   │   ├── call-event.model.ts
    │   │   │   ├── call.model.ts
    │   │   │   └── recording.model.ts
    │   │   ├── repositories/
    │   │   │   ├── call-event.repository.ts
    │   │   │   ├── call.repository.ts
    │   │   │   └── recording.repository.ts
    │   │   ├── routes/
    │   │   │   ├── call.routes.ts
    │   │   │   └── plivo.webhooks.ts
    │   │   ├── services/
    │   │   │   └── call.service.ts
    │   │   └── validators/
    │   │       └── call.schema.ts
    │   ├── health/
    │   │   ├── controllers/
    │   │   │   └── health.controller.ts
    │   │   └── routes/
    │   │       └── health.routes.ts
    │   └── users/
    │       ├── controllers/
    │       │   └── user.controller.ts
    │       ├── models/
    │       │   └── user.model.ts
    │       ├── repositories/
    │       │   └── user.repository.ts
    │       ├── routes/
    │       │   └── user.routes.ts
    │       ├── services/
    │       │   └── user.service.ts
    │       └── validators/
    │           └── user.schema.ts
    ├── routes/
    │   ├── index.ts
    │   └── metrics.routes.ts
    ├── services/
    │   ├── freeswitch/
    │   │   ├── call-control.service.ts
    │   │   ├── esl-call-handler.service.ts
    │   │   └── freeswitch-mrf.service.ts
    │   ├── health/
    │   │   └── readiness.service.ts
    │   ├── observability/
    │   │   └── metrics.service.ts
    │   ├── recovery/
    │   │   ├── orphan-calls-recovery.service.ts
    │   │   └── recordings-sync.service.ts
    │   └── redis/
    │       ├── idempotency-cache.service.ts
    │       ├── redis.client.ts
    │       └── webhook-dedupe.service.ts
    ├── types/
    │   ├── drachtio.d.ts
    │   └── express.d.ts
    └── utils/
        ├── api-error.ts
        ├── logger.ts
        ├── phone-normalize.ts
        ├── plivo-payload.ts
        └── zod-validate.ts
```

**Optional (after `pnpm build`):**

```
backend/
└── dist/                            # compiler output mirroring src/**/*.js + .d.ts
```

---

## 4. Complete file inventory (every project file, excluding `node_modules/**`)

Sorted like `find backend -type f ! -path '*/node_modules/*' ! -path '*/dist/*' | sort`. **55** files total: **1** script, **46** under `src/**/*.ts`, **8** root project files.

| Path |
|------|
| `Dockerfile` |
| `.dockerignore` |
| `.env` |
| `.env.example` |
| `package.json` |
| `pnpm-lock.yaml` |
| `README.md` |
| `scripts/repeat-hello-calls.ts` |
| `src/app.ts` |
| `src/config/database.ts` |
| `src/config/env.ts` |
| `src/middlewares/correlation.middleware.ts` |
| `src/middlewares/error.middleware.ts` |
| `src/modules/calls/adapters/telephony.adapter.ts` |
| `src/modules/calls/controllers/call.controller.ts` |
| `src/modules/calls/controllers/plivo-answer.controller.ts` |
| `src/modules/calls/models/call-event.model.ts` |
| `src/modules/calls/models/call.model.ts` |
| `src/modules/calls/models/recording.model.ts` |
| `src/modules/calls/repositories/call-event.repository.ts` |
| `src/modules/calls/repositories/call.repository.ts` |
| `src/modules/calls/repositories/recording.repository.ts` |
| `src/modules/calls/routes/call.routes.ts` |
| `src/modules/calls/routes/plivo.webhooks.ts` |
| `src/modules/calls/services/call.service.ts` |
| `src/modules/calls/validators/call.schema.ts` |
| `src/modules/health/controllers/health.controller.ts` |
| `src/modules/health/routes/health.routes.ts` |
| `src/modules/users/controllers/user.controller.ts` |
| `src/modules/users/models/user.model.ts` |
| `src/modules/users/repositories/user.repository.ts` |
| `src/modules/users/routes/user.routes.ts` |
| `src/modules/users/services/user.service.ts` |
| `src/modules/users/validators/user.schema.ts` |
| `src/routes/index.ts` |
| `src/routes/metrics.routes.ts` |
| `src/server.ts` |
| `src/services/freeswitch/call-control.service.ts` |
| `src/services/freeswitch/esl-call-handler.service.ts` |
| `src/services/freeswitch/freeswitch-mrf.service.ts` |
| `src/services/health/readiness.service.ts` |
| `src/services/observability/metrics.service.ts` |
| `src/services/recovery/orphan-calls-recovery.service.ts` |
| `src/services/recovery/recordings-sync.service.ts` |
| `src/services/redis/idempotency-cache.service.ts` |
| `src/services/redis/redis.client.ts` |
| `src/services/redis/webhook-dedupe.service.ts` |
| `src/types/drachtio.d.ts` |
| `src/types/express.d.ts` |
| `src/utils/api-error.ts` |
| `src/utils/logger.ts` |
| `src/utils/phone-normalize.ts` |
| `src/utils/plivo-payload.ts` |
| `src/utils/zod-validate.ts` |
| `tsconfig.json` |

---

## 5. What each root file does

| File | Purpose |
|------|---------|
| **`package.json`** | Package `sip-backend`: scripts (`build`, `start`, `dev`, `verify:hello`), dependencies. |
| **`pnpm-lock.yaml`** | Locked versions for pnpm. |
| **`tsconfig.json`** | TypeScript compiler options; output to `dist/` when built. |
| **`README.md`** | Local dev and run notes. |
| **`Dockerfile`** | Image build for the API. |
| **`.dockerignore`** | Docker build context exclusions. |
| **`.env.example`** | Env var template for operators. |
| **`.env`** | Local secrets and overrides; do not commit. |

---

## 6. `scripts/`

| File | Purpose |
|------|---------|
| **`repeat-hello-calls.ts`** | Repeated outbound hello calls against a base URL for testing (`pnpm verify:hello`). |

---

## 7. `src/` — entrypoints

| File | Purpose |
|------|---------|
| **`server.ts`** | Boot: MongoDB, ESL outbound server, recovery timers, HTTP server, Redis shutdown hooks. |
| **`app.ts`** | Express app: CORS/helmet/morgan, JSON parsers, **`correlationIdMiddleware`**, **`registerPlivoWebhookRoutes`** (Plivo Answer/Hangup at `/plivo/*` and `/api/plivo/*`), **`/api`** router, error handlers. |

---

## 8. `src/config/`

| File | Purpose |
|------|---------|
| **`database.ts`** | Mongoose connection with retry. |
| **`env.ts`** | Central env: port, Mongo, Redis, logging, **`publicBaseUrl`**, **`freeswitchSipUri`**, Twilio/Plivo credentials and URLs, etc. |

---

## 9. `src/routes/`

| File | Purpose |
|------|---------|
| **`index.ts`** | Mounts `/health`, `/metrics`, `/users`, `/calls`, `/recordings`; imports **`healthRouter`** from **`modules/health`**, **`userRouter`** from **`modules/users`**. |
| **`metrics.routes.ts`** | `GET /api/metrics` → **`metrics.snapshot()`**. |

---

## 10. `src/modules/health/`

| Path | Purpose |
|------|---------|
| **`routes/health.routes.ts`** | `/api/health/live`, `/api/health/`. |
| **`controllers/health.controller.ts`** | Liveness/readiness HTTP handlers. |

---

## 11. `src/services/health/`

| Path | Purpose |
|------|---------|
| **`readiness.service.ts`** | Mongo ping + optional Redis ping; builds readiness payload for the health controller. |

---

## 12. `src/modules/users/`

| Path | Purpose |
|------|---------|
| **`routes/user.routes.ts`** | User REST routes → `controllers/user.controller`. |
| **`controllers/user.controller.ts`** | User HTTP handlers. |
| **`services/user.service.ts`** | User business logic. |
| **`models/user.model.ts`** | User Mongoose model. |
| **`repositories/user.repository.ts`** | User persistence. |
| **`validators/user.schema.ts`** | User request validation (Zod). |

---

## 13. `src/modules/calls/`

| Path | Purpose |
|------|---------|
| **`routes/call.routes.ts`** | Calls + recordings API routes and recording webhooks under `/api/calls`. |
| **`routes/plivo.webhooks.ts`** | **`registerPlivoWebhookRoutes(app)`** — mounts Plivo XML Answer/Hangup on the root `app` (not under `/api`). |
| **`controllers/call.controller.ts`** | Call/recording HTTP handlers (thin → **`call.service`**). |
| **`controllers/plivo-answer.controller.ts`** | Plivo Answer XML + Hangup JSON ack. |
| **`services/call.service.ts`** | Outbound hello, events, recordings, idempotency, local WAV listing, webhook dedupe + ingest, ESL-facing persistence helpers. |
| **`adapters/telephony.adapter.ts`** | Plivo / Twilio / sip-local dialing (reads credentials from **`env`**). |
| **`models/*.ts`** | `Call`, `CallEvent`, `Recording` schemas. |
| **`repositories/*.ts`** | Mongoose data access (including orphan-sweep and disk-sync helpers used by recovery). |
| **`validators/call.schema.ts`** | Call-related Zod schemas and exported payload types. |

---

## 14. `src/services/` (shared infrastructure)

| Path | Purpose |
|------|---------|
| **`freeswitch/esl-call-handler.service.ts`** | Outbound ESL TCP server; hello media flow; persists via **`CallService`** (no direct repository access from ESL). |
| **`freeswitch/call-control.service.ts`** | Drachtio-fsmrf endpoint helpers. |
| **`freeswitch/freeswitch-mrf.service.ts`** | MRF / `MediaServer` connection helper. |
| **`redis/*`** | ioredis client, idempotency cache, webhook dedupe. |
| **`recovery/*`** | Orphan call sweep and recordings disk ↔ Mongo sync (use **`CallRepository`** / **`RecordingRepository`**). |
| **`observability/metrics.service.ts`** | In-process metrics for `/api/metrics`. |

---

## 15. `src/middlewares/`, `src/utils/`, `src/types/`

| Path | Purpose |
|------|---------|
| **`middlewares/correlation.middleware.ts`** | Sets **`X-Correlation-Id`** / **`req.correlationId`**. |
| **`middlewares/error.middleware.ts`** | Global error and 404 handlers. |
| **`utils/logger.ts`** | Structured logging (level/format from **`env`**). |
| **`utils/api-error.ts`** | HTTP error type. |
| **`utils/zod-validate.ts`** | Zod **`safeParse`** → **`ApiError`** helper. |
| **`utils/phone-normalize.ts`** | Phone normalization (e.g. E164). |
| **`utils/plivo-payload.ts`** | Pure helpers for Plivo query/body fields (`KullooCallId`, `CallUUID`, etc.). |
| **`types/express.d.ts`** | Express `Request` augmentation (`correlationId`). |
| **`types/drachtio.d.ts`** | Drachtio-related typings. |

---

## 16. How pieces connect (quick reference)

1. **HTTP** — `server.ts` → `app.ts` → `routes/index.ts` → feature routers → controllers → services → repositories → models.
2. **Plivo Answer (XML)** — `app.ts` → **`registerPlivoWebhookRoutes`** → **`plivo-answer.controller`** (uses **`env.freeswitchSipUri`**, **`utils/plivo-payload`**).
3. **Outbound hello** — `call.routes` → `call.controller` → `call.service` → `telephony.adapter` + Mongo.
4. **Media (FS path)** — FreeSWITCH `socket` → **`esl-call-handler.service`** → **`CallService`** (status, events, recordings).
5. **Recovery** — `server.ts` starts orphan + recordings sync; they use repositories, not raw models.
6. **Readiness** — `health.routes` → **`health.controller`** → **`readiness.service`** (Mongo + optional Redis).

---

## Related documentation

- [`api.md`](./api.md)
- [`esl.md`](./esl.md), [`inbound-call-dataflow.md`](./inbound-call-dataflow.md), [`outbound-calls.md`](./outbound-calls.md)
- [`redis.md`](./redis.md)

---

*Regenerate the inventory (§4) after adding or removing files: `find backend -type f ! -path '*/node_modules/*' ! -path '*/dist/*' | sort`*
