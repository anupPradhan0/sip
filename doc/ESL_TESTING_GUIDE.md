# ESL Integration Testing Guide

## Overview
The ESL (Event Socket Layer) integration has been implemented. This document provides testing instructions to verify the full call flow and MongoDB metadata creation.

## Prerequisites

1. **Install Dependencies**
   ```bash
   cd backend
   npm install
   ```

2. **Environment Variables**
   Create or update `backend/.env` with:
   ```
   MONGODB_URI=mongodb://localhost:27017/sip-backend
   FREESWITCH_ESL_HOST=localhost
   FREESWITCH_ESL_PORT=8021
   FREESWITCH_ESL_PASSWORD=ClueCon
   ESL_OUTBOUND_PORT=3200
   RECORDINGS_DIR=../recordings
   FREESWITCH_SIP_URI=sip:1000@YOUR_SERVER_IP
   ```

3. **For Docker/Server Deployment**
   Update environment variables:
   ```
   FREESWITCH_ESL_HOST=kulloo-freeswitch
   ESL_OUTBOUND_PORT=3200
   RECORDINGS_DIR=/recordings
   ```

## Testing Locally

### Step 1: Start FreeSWITCH
```bash
cd /path/to/kulloo
docker-compose -f docker-compose.freeswitch.yml up -d
```

### Step 2: Verify FreeSWITCH is Running
```bash
docker ps | grep freeswitch
docker logs kulloo-freeswitch
```

### Step 3: Start Backend
```bash
cd backend
npm run dev
```

Look for these log messages:
- `Connected to FreeSWITCH media server`
- `ESL outbound server listening on port 3200`

### Step 4: Make a Test Call

Using Plivo or direct SIP:
```bash
# If you have sipp or a SIP phone, call:
# sip:1000@YOUR_SERVER_IP
```

Or trigger via Plivo by calling your Plivo number.

### Step 5: Verify Call Flow

**Expected Backend Logs:**
```
New ESL connection from FreeSWITCH
ESL connection ready
Call answered via ESL
Executing call flow for <uuid> (from -> to)
Answering call on endpoint <uuid>
Playing tone 440Hz for 1000ms
Starting recording for call <uuid>
Stopping recording on endpoint <uuid>
Recording completed: { callUuid: '...', filePath: '...', durationSec: 20 }
Recording metadata saved to MongoDB
Call flow completed for <uuid>
```

### Step 6: Verify MongoDB Data

**Check Calls Collection:**
```bash
mongosh
use sip-backend
db.calls.find().pretty()
```

Expected document:
```json
{
  "_id": ObjectId("..."),
  "direction": "inbound",
  "provider": "freeswitch",
  "from": "+1234567890",
  "to": "1000",
  "status": "completed",
  "correlationId": "...",
  "providerCallId": "uuid-from-freeswitch",
  "recordingEnabled": true,
  "timestamps": {
    "receivedAt": ISODate("..."),
    "answeredAt": ISODate("..."),
    "playedAt": ISODate("..."),
    "recordingStartedAt": ISODate("..."),
    "hangupAt": ISODate("..."),
    "completedAt": ISODate("...")
  },
  "createdAt": ISODate("..."),
  "updatedAt": ISODate("...")
}
```

**Check Recordings Collection:**
```bash
db.recordings.find().pretty()
```

Expected document:
```json
{
  "_id": ObjectId("..."),
  "callId": ObjectId("..."),
  "provider": "freeswitch",
  "providerRecordingId": "uuid-from-freeswitch",
  "status": "completed",
  "durationSec": 20,
  "filePath": "/path/to/recordings/uuid.wav",
  "retrievalUrl": "/api/recordings/local/uuid",
  "createdAt": ISODate("..."),
  "updatedAt": ISODate("...")
}
```

**Check CallEvents Collection:**
```bash
db.callevents.find().pretty()
```

Expected events:
- `received`
- `answered`
- `played`
- `recording_started`
- `recording_completed`
- `hangup`
- `completed`

### Step 7: Verify Recording File

```bash
ls -lh recordings/
# Should see: <uuid>.wav

# Play the recording (if you have audio tools)
ffplay recordings/<uuid>.wav
```

### Step 8: Test Recording Retrieval API

```bash
# List all recordings
curl http://localhost:5000/api/recordings/local

# Get specific recording
curl http://localhost:5000/api/recordings/local/<uuid> --output test.wav

# Verify the file
file test.wav
# Should show: test.wav: RIFF (little-endian) data, WAVE audio...
```

## Testing on Server (Dokploy)

### Step 1: Deploy Updated Code

1. Commit and push changes:
   ```bash
   git add .
   git commit -m "Implement ESL integration for FreeSWITCH call control"
   git push
   ```

2. Redeploy both services in Dokploy:
   - Backend app (with new ESL code)
   - FreeSWITCH (with updated dialplan)

### Step 2: Configure Environment Variables

In Dokploy backend app settings, add:
```
FREESWITCH_ESL_HOST=kulloo-freeswitch
FREESWITCH_ESL_PORT=8021
FREESWITCH_ESL_PASSWORD=ClueCon
ESL_OUTBOUND_PORT=3200
```

### Step 3: Update FreeSWITCH Dialplan

In the dialplan XML, ensure `host.docker.internal` is updated to the actual backend service hostname if needed. For Dokploy:
```xml
<action application="socket" data="<backend-service-name>:3200 async full"/>
```

Or use the host machine IP if containers are on different networks.

### Step 4: Make Test Call

Call your Plivo number and verify:
- Call connects
- You hear a 1-second beep (440Hz tone)
- Call records for 20 seconds
- Call hangs up automatically

### Step 5: Check Server Logs

```bash
# Backend logs
docker logs <backend-container-name> -f

# FreeSWITCH logs
docker logs kulloo-freeswitch -f
```

### Step 6: Verify MongoDB

SSH into server and run:
```bash
docker exec -it <mongodb-container> mongosh
use sip-backend
db.calls.find().pretty()
db.recordings.find().pretty()
```

## Troubleshooting

### Issue: "Failed to connect to FreeSWITCH"

**Solution:**
- Verify FreeSWITCH is running: `docker ps | grep freeswitch`
- Check ESL port is accessible: `telnet localhost 8021`
- Verify environment variables are set correctly

### Issue: "ESL connection ready" but no call flow

**Solution:**
- Check FreeSWITCH logs for errors
- Verify dialplan is mounted correctly: `docker exec kulloo-freeswitch cat /usr/local/freeswitch/conf/dialplan/mrf.xml`
- Ensure `socket` application points to correct host and port

### Issue: "Recording file not found"

**Solution:**
- Verify recordings directory is mounted: `docker exec kulloo-freeswitch ls -la /recordings`
- Check permissions on host recordings directory
- Ensure `RECORDINGS_DIR` environment variable matches mount path

### Issue: No MongoDB data created

**Solution:**
- Verify MongoDB connection in backend logs
- Check `MONGODB_URI` environment variable
- Ensure MongoDB is accessible from backend container

## Future DTMF Testing

Once basic flow works, test DTMF detection:

1. Add DTMF handler in call flow
2. During recording, press digits on phone
3. Verify backend receives DTMF events
4. Test "Press 1 to stop recording" functionality

## Success Criteria

✅ Backend connects to FreeSWITCH ESL successfully
✅ ESL outbound server starts on port 3200
✅ Incoming call triggers ESL connection
✅ Call flow executes: answer → play → record → hangup
✅ Call document created in MongoDB with all timestamps
✅ Recording document created with file path and metadata
✅ CallEvents created for each step
✅ WAV file exists in recordings directory
✅ Recording can be retrieved via API endpoint
✅ No errors in backend or FreeSWITCH logs
