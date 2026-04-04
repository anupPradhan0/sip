# Kulloo documentation

This folder is the **main narrative** for the Kulloo project. It is meant for **people** onboarding or designing features and for **AI assistants** that need accurate architecture and file-placement rules without scanning the whole repository.

---

## What is Kulloo?

Kulloo is a **TypeScript/Node calling backend**: an **Express** API, **MongoDB** as the system of record for calls, events, and recordings, and **Redis** (required) for idempotency caching and recording-webhook deduplication. **FreeSWITCH** handles SIP/RTP and media; Kulloo runs an **ESL** (Event Socket) TCP server so FreeSWITCH can connect in and run the scripted “hello” flow (answer, tone, record, DTMF, hangup). **Outbound** calls are often placed via **Plivo** (or other adapters); a stable **`KullooCallId`** links the HTTP-created `Call` document to the media leg on FreeSWITCH.

---

## Repository map (outside `doc/`)

| Path | Role |
|------|------|
| [`backend/`](../backend/) | Main API package — layout and conventions: [backend/backend-folder-structure.md](backend/backend-folder-structure.md). |
| [`freeswitch/`](../freeswitch/) | Checked-in FreeSWITCH configuration (dialplan, modules, vars). |
| Root `docker-compose*.yml` | Example stacks for API, Redis, Mongo, FreeSWITCH. |

Local run instructions for the API: [`backend/README.md`](../backend/README.md).

---

## How to use this documentation

### For humans

1. Read **What is Kulloo** (above), then skim [product/requirements.md](product/requirements.md) if you care about vision and scope.  
2. For the concrete hello/recording behavior, read [product/hello-call-contract.md](product/hello-call-contract.md).  
3. For telephony, follow what you are changing: [telephony/outbound-calls.md](telephony/outbound-calls.md) (API → Plivo → FS → ESL), [telephony/inbound-call-dataflow.md](telephony/inbound-call-dataflow.md) (DID/SIP → FS → ESL), then [telephony/esl.md](telephony/esl.md) and [telephony/freeswitch.md](telephony/freeswitch.md) as needed.  
4. Keep [reference/api.md](reference/api.md) and [reference/redis.md](reference/redis.md) open for HTTP surface and Redis behavior.  
5. When editing code, use [backend/backend-folder-structure.md](backend/backend-folder-structure.md) so new files land in the right layer (controller vs service vs repository).

### For AI / coding agents

- **Where files go:** [backend/backend-folder-structure.md](backend/backend-folder-structure.md) — start with the section **“Where to put new code”**.  
- **HTTP routes:** [reference/api.md](reference/api.md).  
- **Redis, env vars:** [reference/redis.md](reference/redis.md); extend [`backend/src/config/env.ts`](../backend/src/config/env.ts) instead of scattering `process.env`.  
- **Call lifecycle and IDs:** [telephony/outbound-calls.md](telephony/outbound-calls.md), [telephony/inbound-call-dataflow.md](telephony/inbound-call-dataflow.md), [telephony/esl.md](telephony/esl.md).  
- **Do not assume** extra operational docs exist; a dedicated `stability.md` is not in the tree yet.

In the markdown files below this README, **relative links** are from each file’s own directory unless the text says otherwise.

---

## Product and contracts

| Document | Description |
|----------|-------------|
| [product/requirements.md](product/requirements.md) | Platform vision, scope, phases, high-level data model (Jambonz-inspired direction). |
| [product/hello-call-contract.md](product/hello-call-contract.md) | Hello-call API, recording contract, acceptance-style notes. |

## Backend codebase

| Document | Description |
|----------|-------------|
| [backend/backend-folder-structure.md](backend/backend-folder-structure.md) | Full `backend/` tree and contributor rules for new code. |

## Telephony and data flow

| Document | Description |
|----------|-------------|
| [telephony/inbound-call-dataflow.md](telephony/inbound-call-dataflow.md) | Inbound: Plivo Answer URL → FreeSWITCH → ESL → Mongo. |
| [telephony/outbound-calls.md](telephony/outbound-calls.md) | Outbound: API → Plivo → FreeSWITCH → ESL, `KullooCallId`. |
| [telephony/esl.md](telephony/esl.md) | Event Socket: FreeSWITCH connects to Kulloo (outbound ESL pattern). |
| [telephony/freeswitch.md](telephony/freeswitch.md) | FreeSWITCH config layout, dialplan, Docker notes. |

## Reference

| Document | Description |
|----------|-------------|
| [reference/api.md](reference/api.md) | HTTP routes overview (health, users, calls, callbacks, recordings). |
| [reference/redis.md](reference/redis.md) | Redis keys, TTLs, idempotency cache, webhook dedupe, health. |

---

*Future operational notes (for example a stability runbook) may live at the `doc/` root or under an `operations/` folder.*
