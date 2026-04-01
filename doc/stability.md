  Focus on these 6 stability items first (highest impact for your current inbound setup):
  1. Idempotency + dedupe
  • Ensure repeated Plivo webhooks (answer/hangup) and repeated ESL events don’t create duplicate Call/Recording docs.
  2. Plivo webhook verification
  • Validate Plivo signatures so random traffic can’t trigger calls or mark calls completed.
  3. ESL failure handling + timeouts
  • Put timeouts around each ESL step (answer/play/record/stop) and on failure update DB status + hang up cleanly.
  4. Crash/restart recovery
  • If backend restarts mid-call, detect “orphan” calls and mark them failed/completed; don’t leave dangling
    “recording_started”.
  5. Recording integrity
  • Confirm file exists + non‑zero size before creating “completed” recording metadata; handle early hangups.
  6. Observability basics
  • Add a single correlation ID per call everywhere, plus a few counters (active calls, failed calls, record failures). Even
    simple logs help a lot.