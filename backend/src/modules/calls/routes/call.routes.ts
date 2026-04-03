import { Router } from "express";
import {
  getRecording,
  getRecordingFile,
  listCallRecordings,
  listLocalRecordings,
  localRecordingFile,
  outboundHelloCall,
  plivoRecordingCallback,
  freeswitchRecordingCallback,
  twilioRecordingCallback,
} from "../controllers/call.controller";

export const callRouter = Router();

callRouter.post("/outbound/hello", outboundHelloCall);
callRouter.get("/:callId/recordings", listCallRecordings);
callRouter.post("/callbacks/twilio/recording", twilioRecordingCallback);
callRouter.post("/callbacks/plivo/recording", plivoRecordingCallback);
callRouter.post("/callbacks/freeswitch/recording", freeswitchRecordingCallback);

export const recordingRouter = Router();
recordingRouter.get("/local", listLocalRecordings);
recordingRouter.get("/local/:uuid", localRecordingFile);
recordingRouter.get("/:recordingId", getRecording);
recordingRouter.get("/:recordingId/file", getRecordingFile);
