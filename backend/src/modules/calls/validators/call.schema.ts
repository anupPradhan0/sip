import { z } from "zod";

const providerSchema = z.enum(["sip-local", "twilio", "plivo", "freeswitch"]);

export const outboundHelloSchema = z.object({
  from: z.string().trim().min(1, "from is required"),
  to: z.string().trim().min(1, "to is required"),
  provider: providerSchema.default("sip-local"),
  recordingEnabled: z.boolean().default(true),
});

export const callIdParamSchema = z.object({
  callId: z.string().trim().regex(/^[0-9a-fA-F]{24}$/, "Invalid call id"),
});

export const recordingIdParamSchema = z.object({
  recordingId: z.string().trim().regex(/^[0-9a-fA-F]{24}$/, "Invalid recording id"),
});

export const twilioRecordingCallbackSchema = z.object({
  CallSid: z.string().trim().min(1),
  RecordingSid: z.string().trim().min(1),
  RecordingUrl: z.string().trim().url().optional(),
  RecordingDuration: z.string().trim().optional(),
  RecordingStatus: z.string().trim().optional(),
});

export const plivoRecordingCallbackSchema = z.object({
  RecordingID: z.string().trim().min(1),
  RecordUrl: z.string().trim().url().optional(),
  RecordingDuration: z.string().trim().optional(),
  RecordingDurationMs: z.string().trim().optional(),
});

export const plivoRecordingCallbackQuerySchema = z.object({
  callUuid: z.string().trim().min(1),
});

export const freeswitchRecordingCallbackSchema = z.object({
  callUuid: z.string().trim().min(1),
  durationSec: z.string().trim().optional(),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
});

export type OutboundHelloInput = z.infer<typeof outboundHelloSchema>;
export type TwilioRecordingCallbackPayload = z.infer<typeof twilioRecordingCallbackSchema>;
export type PlivoRecordingCallbackPayload = z.infer<typeof plivoRecordingCallbackSchema>;
export type FreeswitchRecordingCallbackPayload = z.infer<typeof freeswitchRecordingCallbackSchema>;
