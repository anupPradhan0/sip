import Ari from 'ari-client';
import type { Channel } from 'ari-client';
import dotenv from 'dotenv';

dotenv.config();

// ─── Config (from .env) ──────────────────────────────────────────────────────
const ARI_URL       = process.env.ARI_URL       ?? 'http://127.0.0.1:8088';
const ARI_USERNAME  = process.env.ARI_USERNAME  ?? 'asterisk';
const ARI_PASSWORD  = process.env.ARI_PASSWORD  ?? 'asterisk_pass';
const ARI_APP       = process.env.ARI_APP       ?? 'answering-machine';
const HANGUP_DELAY  = parseInt(process.env.HANGUP_DELAY_MS ?? '5000', 10);

// ─── Logger helper ───────────────────────────────────────────────────────────
function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  log(`Connecting to Asterisk ARI at ${ARI_URL} as user "${ARI_USERNAME}"…`);

  let client: Awaited<ReturnType<typeof Ari.connect>>;
  try {
    client = await Ari.connect(ARI_URL, ARI_USERNAME, ARI_PASSWORD);
  } catch (err) {
    console.error('❌  Could not connect to Asterisk ARI:', err);
    console.error('    → Is Asterisk running?  docker compose up -d');
    process.exit(1);
  }

  log(`✅  Connected. Waiting for calls in Stasis app "${ARI_APP}"…`);

  // ── StasisStart fires when a call enters our Stasis() dial-plan step ──────
  client.on('StasisStart', async (event: unknown, channel: Channel) => {
    const callerId = channel.caller?.number ?? 'unknown';
    const channelId = channel.id;

    log(`📞  Incoming call   | caller=${callerId}  channel=${channelId}`);

    try {
      // Answer the call
      await channel.answer();
      log(`✅  Call answered   | channel=${channelId}`);

      // Hang up after HANGUP_DELAY ms
      setTimeout(async () => {
        try {
          await channel.hangup();
          log(`📴  Call ended      | channel=${channelId}  (after ${HANGUP_DELAY / 1000}s)`);
        } catch (hangupErr) {
          // Channel might have been hung up by the caller already — that's fine
          log(`ℹ️   Channel already gone | channel=${channelId}`);
        }
      }, HANGUP_DELAY);

    } catch (answerErr) {
      log(`❌  Failed to answer | channel=${channelId} | ${answerErr}`);
    }
  });

  // ── StasisEnd fires when a channel leaves our app (caller hung up early etc)
  client.on('StasisEnd', (_event: unknown, channel: Channel) => {
    log(`🔚  StasisEnd        | channel=${channel.id}`);
  });

  // Start listening on our named Stasis app
  client.start(ARI_APP);
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
