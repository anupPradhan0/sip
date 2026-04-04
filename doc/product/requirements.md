# AI Calling Platform Requirements (TS + Mongo, Jambonz-Inspired)

> **Doc hub:** [Documentation index](../README.md) — how this folder fits the rest of Kulloo.

## Purpose

Define what we want to build: a production-ready AI calling platform inspired by the current Jambonz deployment architecture, reimplemented with TypeScript-first services and MongoDB as the primary data store, then integrated into Chati as an `AI Calling` module.

## Vision

Build an internal platform that can:

- Place and receive calls reliably at scale.
- Run real-time AI voice conversations (STT -> LLM -> TTS).
- Execute outbound campaigns with retry and rate control.
- Provide complete analytics (transcripts, summaries, outcomes).
- Integrate tightly with Chati workflows and UI.

## Scope

### In Scope

- Telephony core: SIP trunk integration, inbound/outbound call handling, media control.
- TypeScript call-control services and event-driven architecture.
- MongoDB-based domain storage for calls, campaigns, transcripts, and analytics.
- AI voice pipeline services (STT, LLM, TTS) with provider abstraction.
- Chati `AI Calling` module integration.

### Out of Scope (Phase 1-3)

- Full custom SIP proxy/router replacement from day one.
- Odia model training in the initial release (kept as parallel track).
- Multi-region active-active deployment before platform stability is proven.

## Reference Architecture (What to Keep From Jambonz Design)

Use the current repository as architecture reference, especially service separation:

- Edge SIP handling and SBC concerns.
- Drachtio-based call signaling control.
- FreeSWITCH media server for RTP, playback, recording, DTMF.
- Dedicated control plane (API/webhook logic) separated from media plane.
- Operational readiness: health checks, metrics, env-driven config, containerized deploys.

## Target Architecture (New Platform)

### Core Infrastructure

- SIP trunk provider + DID inventory.
- Drachtio server(s).
- FreeSWITCH media server(s).
- MongoDB replica set (system of record).
- Redis (ephemeral call/session state, locks, rate limiting).
- RabbitMQ/NATS (campaign queueing and async tasks).
- Prometheus + Grafana (metrics dashboards and alerting).

### Core Services (TypeScript)

- `call-control-service`: call state machine, inbound/outbound orchestration.
- `media-gateway-service`: media session coordination and streaming bridge.
- `ai-orchestrator-service`: STT -> LLM -> TTS turn pipeline.
- `campaign-service`: campaign definitions, schedules, pacing, retry policy.
- `dialer-worker`: outbound execution workers consuming queue jobs.
- `api-gateway`: APIs for Chati and operator workflows.
- `analytics-service`: post-call summaries, intent tags, KPIs.

## Functional Requirements

1. Inbound call flow: receive -> authenticate/routable match -> execute bot/workflow.
2. Outbound call flow: originate -> connect -> bot/workflow execution -> termination.
3. Call controls: answer, play, gather DTMF, transfer, hangup, recording.
4. Real-time speech loop:
   - Capture live audio.
   - Convert speech to text.
   - Generate response with LLM.
   - Convert response to speech and play.
5. Campaign controls:
   - Contact upload.
   - Scheduling.
   - Retry/backoff logic.
   - Rate control and concurrency caps.
6. Conversation persistence:
   - Transcripts.
   - Turn-by-turn history.
   - Outcome classification.

## Non-Functional Requirements

- Reliability: target 99.9% successful call flow execution for stable trunks.
- Latency: target under 1.5s median AI response turn (speech end to audio start).
- Idempotency: event handlers must be safe on duplicate delivery.
- Scalability: horizontal workers and stateless services.
- Observability: structured logs, metrics, traces, call-level correlation IDs.
- Security: encrypted secrets, least-privilege credentials, audit events.

## Data Requirements (MongoDB Collections)

- `accounts`, `numbers`, `trunks`, `applications`
- `calls`, `callLegs`, `recordings`
- `transcripts`, `conversationTurns`
- `campaigns`, `contacts`, `dialAttempts`
- `bots`, `botConfigs`, `integrations`
- `events` (append-only for replay and audit)

## Chati Integration Requirements

Add new product module: `AI Calling`

### Features

- Voice bot creation and configuration.
- Campaign manager (contacts, schedule, retry, pacing).
- Live call monitor.
- Conversation log viewer.
- Analytics dashboard (volume, success rate, intent, summary).

### Integration Contracts

- Webhook contract for inbound call decisions and next-step actions.
- Event stream contract for call lifecycle and transcript updates.
- API contract for campaign operations and analytics queries.

## Delivery Plan

### Phase A: Foundation (2-3 weeks)

- Provision SIP trunk + DID.
- Bring up Drachtio + FreeSWITCH + Mongo + Redis + queue.
- Prove basic inbound/outbound call and recording.

### Phase B: TS Control Layer (3 weeks)

- Build `call-control-service`.
- Implement typed call state machine.
- Persist call lifecycle in MongoDB.

### Phase C: Real-Time AI Loop (4-5 weeks)

- Add streaming path.
- Integrate STT, LLM, and TTS adapters.
- Stabilize turn-taking and interruption handling.

### Phase D: Campaigns + Analytics (4-5 weeks)

- Implement campaign scheduler + dialer workers.
- Add transcript summaries and KPI dashboards.

### Phase E: Scale and Hardening

- Load/perf tests.
- Multi-node scaling for media/control.
- HA strategy for queue and database.

## First Milestone (Do This First)

Deliver one end-to-end "hello call" flow:

1. Inbound call reaches platform.
2. Call is answered.
3. One audio/TTS message is played.
4. Call is hung up cleanly.
5. One call record is written to MongoDB.
6. Run 10 successful real calls.

No AI/campaign features should start before this milestone is stable.

## Risks and Mitigations

- SIP/NAT/RTP complexity -> enforce early carrier/network test matrix.
- AI latency spikes -> async buffering + fallback prompts + timeout guards.
- Provider dependency risk -> adapter pattern for STT/TTS/LLM.
- Campaign overload -> queue-based pacing and per-trunk concurrency limits.

## Definition of Success

Platform is successful when:

- It runs stable inbound/outbound voice automation in production.
- Chati users can configure bots and campaigns without telephony internals.
- Analytics clearly show call outcomes and conversation quality.
- Architecture supports future Odia STT/TTS model replacement without core rewrites.


