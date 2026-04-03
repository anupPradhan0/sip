# Kulloo API Reference

Base URL (production): `https://kulloocall.anuppradhan.in`

All routes below are relative to the base URL.

## Health

- `GET /api/health/live`
  - Liveness probe (process responding)
- `GET /api/health`
  - Readiness probe (includes Mongo ping)

## Users

- `POST /api/users`
  - Create user
- `GET /api/users`
  - List users
- `GET /api/users/:id`
  - Get user by id
- `PATCH /api/users/:id`
  - Update user
- `DELETE /api/users/:id`
  - Delete user

## Calls

- `POST /api/calls/outbound/hello`
  - Runs the outbound “hello” flow
  - Required header: `Idempotency-Key: <unique>`
- `GET /api/calls/:callId/recordings`
  - List recording metadata for a call

### Provider callbacks (webhooks)

- `POST /api/calls/callbacks/twilio/recording`
- `POST /api/calls/callbacks/plivo/recording`
- `POST /api/calls/callbacks/freeswitch/recording`

## Recordings

### Local recordings (shared `/recordings` volume)

- `GET /api/recordings/local`
  - Lists local `.wav` files
- `GET /api/recordings/local/:uuid`
  - Streams local `.wav` file (UUID without `.wav`)

### Recording metadata + file

- `GET /api/recordings/:recordingId`
  - Returns recording metadata from MongoDB
- `GET /api/recordings/:recordingId/file`
  - Streams recording file if `filePath` exists in MongoDB

## Plivo XML application webhooks

These routes return Plivo XML (Answer URL) or a simple JSON success (Hangup URL).

- `ANY /plivo/answer`
- `ANY /api/plivo/answer`
- `POST /plivo/hangup`
- `POST /api/plivo/hangup`

