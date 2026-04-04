# Outbound calls (Kulloo)

This document describes how **outbound PSTN** (and related) calls work in Kulloo: architecture, **data flow**, identifiers, MongoDB shape, FreeSWITCH/ESL behavior, and configuration. It matches the current backend under `backend/`.

---

## 1. Goals and split of responsibilities

**Problem:** Originate a call to a real phone number (PSTN), run **media** on infrastructure you control (playback, recording, DTMF), and persist **one** logical call in MongoDB across Plivo and FreeSWITCH.

**Approach:**

| Layer | Role |
|--------|------|
| **Kulloo API** | Creates the `Call` document **before** dialing; enforces idempotency; triggers Plivo (or Twilio / local simulation). |
| **Plivo** | PSTN origination and carrier connectivity. When the callee answers, Plivo requests your **Answer URL**; you return XML that **bridges** the call into FreeSWITCH. |
| **FreeSWITCH** | Media plane: answer, tone, `record_session`, DTMF, hangup. |
| **ESL (Event Socket, outbound mode)** | Node listens on `ESL_OUTBOUND_PORT`; FreeSWITCH `socket` app connects **in** to Kulloo and runs the scripted flow in `esl-call-handler.service.ts`. |
| **MongoDB** | `Call`, `CallEvent`, `Recording` — keyed by a stable business id plus provider-specific ids. |

Recording for the **Plivo + FreeSWITCH** path is **not** primarily Plivo’s cloud recording for this hello flow; the WAV is written by **FreeSWITCH** under `RECORDINGS_DIR` and metadata is updated from ESL.

---

## 2. The “call spine” (stable business id)

Kulloo uses the same **concept** as Jambonz’s `call_sid`, with different naming:

- **Canonical stable id:** Mongo `Call._id` (24-character hex ObjectId).
- **API alias:** Virtual field `callSid` on `Call` (same value as `_id` in JSON).
- **SIP / Plivo carry:** Custom header name **`KullooCallId`** (value = that hex id). Plivo also echoes it as **`X-PH-KullooCallId`** on Answer URL HTTP params in many cases.
- **HTTP tracing (separate):** `correlationId` on the `Call` is set when the outbound API runs; Express may also set `X-Correlation-Id` per HTTP request. Do **not** confuse `correlationId` with the telephony spine.

**Why create `Call` before Plivo?** If Plivo’s API fails, you still have a row (`failed` + events) and can retry with a **new** idempotency key or the same key depending on product rules.

---

## 3. Multiple ids on one logical call (normal)

| Id | Meaning | When it exists |
|----|---------|----------------|
| `Call._id` / `callSid` | Stable business id | Created first in API |
| `upstreamCallId` + `upstreamProvider: "plivo"` | Plivo **Request UUID** (from `calls.create`) | After Plivo accepts the dial |
| `providerCallId` | FreeSWITCH **channel UUID** once ESL attaches | Starts as `pending-<callSid>` for Plivo outbound to satisfy unique index; replaced by real UUID in ESL |
| Plivo `CallUUID` | Plivo’s call identifier on webhooks | Present on Answer URL requests |

You intentionally **do not** require all of these strings to be equal; ESL **maps** FS UUID → existing `Call` using `KullooCallId`.

---

## 4. End-to-end data flow (production Plivo path)

```mermaid
sequenceDiagram
  participant Client
  participant API as Kulloo_API
  participant Mongo as MongoDB
  participant Plivo
  participant FS as FreeSWITCH
  participant ESL as ESL_Handler

  Client->>API: POST /api/calls/outbound/hello + Idempotency-Key
  API->>Mongo: Create Call (_id, pending providerCallId, initiated)
  API->>Plivo: calls.create(from,to,answerUrl+sipHeaders+query)
  Plivo-->>API: requestUuid
  API->>Mongo: upstreamProvider/upstreamCallId, status connected
  API-->>Client: 200 { call, recordings: [] }

  Note over Plivo,Callee: PSTN rings; callee answers
  Plivo->>API: GET/POST Answer URL (CallUUID, X-PH-KullooCallId, kullooCallId)
  API-->>Plivo: XML Dial User FREESWITCH_SIP_URI sipHeaders KullooCallId

  Plivo->>FS: SIP to extension / user matching FREESWITCH_SIP_URI
  FS->>ESL: Outbound socket connect (per dialplan)
  ESL->>Mongo: findByStableCallId(KullooCallId), patch providerCallId=FS_UUID
  ESL->>FS: answer, tone, record_session, DTMF listen, stop, hangup
  ESL->>Mongo: status/events/recording metadata
```

**Important:** The HTTP response from `POST /api/calls/outbound/hello` returns when **Plivo has accepted the dial** and the `Call` is **`connected`** (for `provider: "plivo"`). Final states (`answered`, `played`, `recording_started`, `hangup`, `completed`) and `Recording` rows are updated **asynchronously** by ESL while the call runs.

---

## 5. HTTP API

- **Route:** `POST /api/calls/outbound/hello`
- **Required header:** `Idempotency-Key` — duplicate key returns the **existing** `Call` and its recordings list without placing a second dial.
- **Body (Zod):** `from`, `to`, `provider` (`sip-local` \| `twilio` \| `plivo` \| `freeswitch`), `recordingEnabled` (default `true`).

### Behavior by `provider`

| Provider | What happens |
|----------|----------------|
| **`plivo`** | `Call.provider` is stored as **`freeswitch`** (media plane). Plivo dials; Answer XML bridges to FS. **`runOutboundHelloFlow` only** sets `connected` + upstream ids; **ESL** owns the rest. |
| **`twilio`** | Twilio REST `calls.create` with TwiML; Kulloo simulates timestamps in the service (no ESL for that path in the hello contract). |
| **`sip-local`** | No real carrier; adapter returns fake timestamps and the service drives the full happy path in process. |

This document’s **PSTN** focus is the **`plivo`** row above.

---

## 6. Plivo: `TelephonyAdapter.executePlivoHello`

- Reads `PLIVO_AUTH_ID`, `PLIVO_AUTH_TOKEN`, `PLIVO_ANSWER_URL`, optional `PLIVO_HANGUP_URL`.
- Appends **`?kullooCallId=<Call._id>`** to the answer URL so correlation survives GET vs POST and missing header echo on the HTTP callback.
- Passes **`sipHeaders: "KullooCallId=<id>"`** on `calls.create` so the value reaches the SIP leg toward FreeSWITCH.
- Uses `answerMethod: "GET"` by default on create.
- Returns **`providerCallId`** = Plivo **`requestUuid`** (used as `upstreamCallId` in Mongo).

**Plivo account rules:** `from` must be a **verified Plivo number** for your account; `to` is the destination.

---

## 7. Answer URL → FreeSWITCH XML (`app.ts`)

Routes: **`ANY /plivo/answer`** and **`ANY /api/plivo/answer`** (same handler).

1. Resolve `kullooCallId` via `extractPlivoKullooCallId` (query + body, keys such as `kullooCallId`, `X-PH-KullooCallId`, case variants).
2. Read `FREESWITCH_SIP_URI` (e.g. `sip:1000@<fs-public-ip>`). If missing, return XML with a spoken error + hangup.
3. Return Plivo XML:

```xml
<Response>
  <Dial sipHeaders="KullooCallId=...">
    <User>FREESWITCH_SIP_URI</User>
  </Dial>
</Response>
```

If `kullooCallId` is missing, `<Dial>` still runs but without `sipHeaders`; ESL then **cannot** attach to the pre-created outbound `Call` (you get a **new** inbound-style `Call` keyed only by FS UUID — avoid this in production by keeping answer URL + create aligned).

Structured logs: `plivo_answer_bridge_to_freeswitch`, `plivo_answer_missing_kulloo_call_id`, etc.

---

## 8. FreeSWITCH dialplan and ESL

**Dialplan** (`freeswitch/conf/dialplan/hello.xml`): for destination `1000` or `hello`, run **`socket`** to the Kulloo ESL listener host:port (your deployment sets the IP; repo may show a concrete example — align with `ESL_OUTBOUND_PORT`, typically **3200**).

**ESL handler** (`backend/src/services/freeswitch/esl-call-handler.service.ts`):

1. Parse channel UUID, from/to, and **`kullooCallId`** from channel data or variables such as `sip_h_X-PH-KullooCallId` / `variable_sip_h_X-PH-KullooCallId`.
2. If `kullooCallId` is a valid 24-hex id: **`findByStableCallId`**, then **`updateById`** with real **`providerCallId`** = FS channel UUID, preserve API `from` / `to` (FS may show internal extension e.g. `1000` as destination).
3. If no stable id: **`findOrCreateByProviderCallId("freeswitch", uuid)`** — treats as **inbound** (not the outbound Plivo scenario).
4. Flow: **answer** → short **sleep** → **playback** (tone/beep) → **`record_session`** to `RECORDINGS_DIR/<fs-uuid>.wav` → listen for **DTMF “1”** to stop early or **20s** timeout → **stop_record_session** → optional confirm tone → **hangup** → update **`Call`** / **`CallEvent`** / **`Recording`**.

ESL logs include **`callId`** and **`callSid`** (same Mongo id) when the call document is known.

---

## 9. MongoDB: `Call` document (outbound Plivo summary)

Typical lifecycle fields:

- `direction: "outbound"`
- `provider: "freeswitch"` (media)
- `upstreamProvider: "plivo"`, `upstreamCallId: <plivo request uuid>`
- `providerCallId: "pending-<callSid>"` → later **FS UUID**
- `status`: progresses via ESL (`answered` → … → `completed`)
- `correlationId`: from API handler (`randomUUID()`)
- `idempotencyKey`: from header
- `timestamps.*` filled as the flow advances
- Virtual **`callSid`** in JSON = `_id` hex

Unique indexes (see `call.model.ts`):

- `{ provider, providerCallId }` sparse unique — hence **`pending-…`** until real UUID.
- `{ upstreamProvider, upstreamCallId }` sparse unique — set **only together** after Plivo returns an id (avoids duplicate-null issues).

---

## 10. Events and recordings

- **`CallEvent`:** `pushEvent` records `initiated`, `connected`, `answered`, `played`, `recording_started`, DTMF, `hangup`, `completed`, `failed`, etc. Uses `call.correlationId` on the event row.
- **`Recording`:** For Plivo+FS hello, primary path is **FS file** + ESL **`handleRecordingComplete`**. `providerRecordingId` is often the **FS UUID**; `callId` references the `Call` document. Retrieval may use `/api/recordings/local/:uuid` when served from disk.

---

## 11. DTMF

During recording, ESL subscribes to DTMF events. Digit **`1`** stops recording early, then playback of a short tone, then hangup. Events may be persisted as `CallEvent` with type `dtmf`.

---

## 12. Environment variables (checklist)

| Variable | Purpose |
|----------|---------|
| `MONGODB_URI` | Persist calls |
| `PLIVO_AUTH_ID` / `PLIVO_AUTH_TOKEN` | Plivo REST |
| `PLIVO_ANSWER_URL` | Public URL hit when call answered (must reach `sendPlivoAnswerXml`) |
| `PLIVO_HANGUP_URL` | Optional hangup webhook |
| `PUBLIC_BASE_URL` | Used when building absolute URLs from request context (if set, prefer explicit) |
| `FREESWITCH_SIP_URI` | Target in Plivo `<Dial><User>` — must match a dialplan that `socket`s to ESL |
| `RECORDINGS_DIR` | WAV directory (shared volume with FS in production) |
| `ESL_OUTBOUND_PORT` | Port Kulloo listens on for FS outbound socket (e.g. 3200) |
| `FREESWITCH_ESL_*` | Optional for inbound ESL client patterns; outbound socket is separate |

---

## 13. Troubleshooting (symptoms → what to check)

- **`plivo_answer_missing_kulloo_call_id`:** Answer URL reached without stable id — verify `PLIVO_ANSWER_URL` on create includes `kullooCallId` query and `sipHeaders` on `calls.create`.
- **`E11000` duplicate key on `provider` + `providerCallId`:** Do not create freeswitch calls with `providerCallId: null`; Plivo path uses `pending-…` until ESL patches.
- **`E11000` on `upstreamProvider` + `upstreamCallId`:** Do not set `upstreamProvider` without Plivo’s id yet.
- **API stuck at `connected`:** Normal until ESL runs; verify FS reaches Kulloo on `ESL_OUTBOUND_PORT` and dialplan matches `FREESWITCH_SIP_URI`.
- **Wrong `to` saved as `1000`:** ESL attach should preserve API `from`/`to`; if not, correlation may have fallen through to inbound `findOrCreate` path.

---

## 14. Source file map

| Area | Path |
|------|------|
| HTTP route | `backend/src/modules/calls/routes/call.routes.ts` |
| Controller | `backend/src/modules/calls/controllers/call.controller.ts` |
| Orchestration | `backend/src/modules/calls/services/call.service.ts` (`runOutboundHelloFlow`) |
| Plivo/Twilio/local dial | `backend/src/modules/calls/adapters/telephony.adapter.ts` |
| Validation | `backend/src/modules/calls/validators/call.schema.ts` |
| Models / indexes | `backend/src/modules/calls/models/call.model.ts` |
| Repositories | `backend/src/modules/calls/repositories/*.ts` |
| Plivo XML | `backend/src/app.ts` (`sendPlivoAnswerXml`, `extractPlivoKullooCallId`) |
| ESL | `backend/src/services/freeswitch/esl-call-handler.service.ts` |
| FS dialplan example | `freeswitch/conf/dialplan/hello.xml` |
| Bootstrap ESL port | `backend/src/server.ts` |

---

## 15. Related docs

- `doc/api.md` — HTTP surface
- `doc/esl.md` — ESL concepts and data flow (FreeSWITCH → Kulloo)
- `doc/hello-call-contract.md` — hello contracts (outbound + real inbound via FS)
- `doc/stability.md` — operational stability notes

---

*Last updated to reflect the Kulloo repo layout and Plivo + FreeSWITCH + ESL outbound hello flow.*
