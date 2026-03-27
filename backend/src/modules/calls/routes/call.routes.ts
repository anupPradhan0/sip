import { Router } from "express";
import {
  getRecording,
  inboundHelloCall,
  listCallRecordings,
  outboundHelloCall,
  twilioRecordingCallback,
} from "../controllers/call.controller";

export const callRouter = Router();

callRouter.post("/inbound/hello", inboundHelloCall);
callRouter.post("/outbound/hello", outboundHelloCall);
callRouter.get("/:callId/recordings", listCallRecordings);
callRouter.post("/callbacks/twilio/recording", twilioRecordingCallback);

export const recordingRouter = Router();
recordingRouter.get("/:recordingId", getRecording);
