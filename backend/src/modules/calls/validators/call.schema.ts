import { z } from "zod";

const providerSchema = z.enum(["sip-local", "twilio", "plivo"]);

export const inboundHelloSchema = z.object({
  from: z.string().trim().min(1, "from is required"),
  to: z.string().trim().min(1, "to is required"),
  provider: providerSchema.default("sip-local"),
  providerCallId: z.string().trim().optional(),
  recordingEnabled: z.boolean().default(true),
});

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

export type InboundHelloInput = z.infer<typeof inboundHelloSchema>;
export type OutboundHelloInput = z.infer<typeof outboundHelloSchema>;
