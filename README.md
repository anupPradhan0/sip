# sip

Learning and experimenting with **SIP (Session Initiation Protocol)** — the signaling protocol used to set up, manage, and tear down real‑time voice/video calls over IP networks.

This project runs a **minimal SIP answering machine**: Asterisk (SIP server) in Docker + a **Node.js/TypeScript** controller that auto-answers every incoming call and hangs up after 5 seconds.

---

## How it works

```
Zoiper / Linphone (your phone)
        │  SIP INVITE  UDP 5060
        ▼
┌─────────────────────┐
│  Asterisk (Docker)  │  SIP engine + media
│  port 5060 SIP      │
│  port 8088 ARI/HTTP │
└──────────┬──────────┘
           │  WebSocket (ARI)
           ▼
┌─────────────────────┐
│  src/index.ts       │  Node.js controller
│  answer → 5s → BYE  │
└─────────────────────┘
```

---

## Quick start

### 1. Start Asterisk

```bash
docker compose up -d
```

Wait ~5 s for Asterisk to boot, then verify:

```bash
docker exec asterisk asterisk -rx "core show version"
```

### 2. Install dependencies

```bash
npm install
```

### 3. Build & run the Node.js controller

```bash
npm run build
npm start
```

You should see:
```
[...] Connecting to Asterisk ARI at http://127.0.0.1:8088 …
[...] ✅  Connected. Waiting for calls in Stasis app "answering-machine"…
```

### 4. Open a SIP client (Zoiper or Linphone)

Add a SIP account with:
| Field | Value |
|---|---|
| Domain/Server | `192.168.29.83:5060` |
| Username | `phone1` |
| Password | `phone1pass` |

Find your LAN IP:
```bash
ip addr show | grep 'inet ' | grep -v 127.0.0.1
```

### 5. Make a call

Dial any number (e.g. `1000`). The call will be answered immediately and hang up after **5 seconds**.

Terminal output:
```
[...] 📞  Incoming call   | caller=phone1  channel=<id>
[...] ✅  Call answered   | channel=<id>
[...] 📴  Call ended      | channel=<id>  (after 5s)
```

---

## File structure

```
sip/
├── docker/
│   └── asterisk/
│       ├── sip.conf           # SIP peers (phone1, phone2)
│       ├── extensions.conf    # Dial-plan → Stasis app
│       ├── ari.conf           # ARI REST API credentials
│       └── http.conf          # HTTP server for ARI (port 8088)
├── src/
│   └── index.ts               # Node.js ARI controller
├── docker-compose.yml
├── package.json
├── tsconfig.json
└── .env                       # ARI credentials + hangup delay
```

---

## Configuration

Edit **`.env`** to change credentials or the hangup delay:

```env
ARI_URL=http://127.0.0.1:8088
ARI_USERNAME=asterisk
ARI_PASSWORD=asterisk_pass
ARI_APP=answering-machine
HANGUP_DELAY_MS=5000
```

> **Note:** Keep phone and server on the **same Wi‑Fi** for audio. If on different networks, SIP signalling works but RTP audio will be silent.

---

## Second SIP client (optional)

`sip.conf` also defines `phone2` / `phone2pass` so you can register a second softphone and call between `phone1` and `phone2` — both go through Asterisk.
