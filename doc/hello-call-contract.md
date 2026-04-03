# Hello-Call Contract

## Purpose
Lock the first production-like call flow before larger architecture changes.

## Real inbound (FreeSWITCH → ESL)

There is **no** HTTP “inbound hello” endpoint. PSTN/SIP callers hit **FreeSWITCH**; the dialplan connects to Kulloo via **ESL**. Calls are created in Mongo when `executeCallFlow` runs (`direction=inbound`, `providerCallId` = FreeSWITCH channel UUID).

## Outbound hello (API → Plivo → FreeSWITCH → ESL)

Flow: `initiate -> connect -> play -> record -> hangup -> completed`

### Endpoint
- `POST /api/calls/outbound/hello`

### Headers
- `Idempotency-Key: <unique-key>` (required)

### Request
```json
{
  "to": "+15551234567",
  "from": "+15557654321",
  "provider": "sip-local",
  "recordingEnabled": true
}
```

### Behavior
1. Enforce idempotency by key.
2. Create call record with `direction=outbound`.
3. Execute provider adapter (`sip-local` or `twilio`).
4. Persist call events and recording metadata.
5. Return final call state.

## Recording Retrieval Contract

### Endpoints
- `GET /api/calls/:callId/recordings`
- `GET /api/recordings/:recordingId`

### Guarantees
- Recording metadata is persisted for every recording-enabled hello call.
- Response includes retrieval URL or provider-native URL when available.
- Status values: `pending | completed | failed`.

## Failure/Timeout Rules
- Provider errors must set call status to `failed`.
- All failures append an event with `eventType=failed` and include error payload.
- Duplicate outbound requests with the same idempotency key return the already-created call.

## Correlation and Logging
- Each call stores a generated `correlationId`.
- Logs include `correlationId`, `callId`, `provider`, and current status.

## Acceptance Criteria
1. Real inbound calls (FS → ESL) persist `Call` + events to terminal status when ESL completes the flow.
2. Outbound hello-call ends in `completed` for `sip-local`; `twilio` path accepted when credentials are configured.
3. Recording metadata retrievable from API.
4. 10-20 repeated calls complete without process crash.
5. Mongo data consistency:
   - every completed call has terminal status
   - event sequence is ordered
   - recording references a valid `callId`.
