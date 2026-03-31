import { model, Schema, Types } from "mongoose";

export type CallDirection = "inbound" | "outbound";
export type CallProvider = "sip-local" | "twilio" | "plivo" | "freeswitch";
export type CallStatus =
  | "received"
  | "initiated"
  | "answered"
  | "connected"
  | "played"
  | "recording_started"
  | "hangup"
  | "completed"
  | "failed";

export interface CallDocument {
  _id: Types.ObjectId;
  direction: CallDirection;
  provider: CallProvider;
  from: string;
  to: string;
  fromRaw?: string;
  toRaw?: string;
  fromE164?: string;
  toE164?: string;
  callerName?: string;
  status: CallStatus;
  correlationId: string;
  providerCallId?: string;
  idempotencyKey?: string;
  recordingEnabled: boolean;
  timestamps: {
    receivedAt?: Date;
    answeredAt?: Date;
    connectedAt?: Date;
    playedAt?: Date;
    recordingStartedAt?: Date;
    hangupAt?: Date;
    completedAt?: Date;
    failedAt?: Date;
  };
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const callSchema = new Schema<CallDocument>(
  {
    direction: { type: String, enum: ["inbound", "outbound"], required: true },
    provider: { type: String, enum: ["sip-local", "twilio", "plivo", "freeswitch"], required: true },
    from: { type: String, required: true, trim: true },
    to: { type: String, required: true, trim: true },
    fromRaw: { type: String, trim: true },
    toRaw: { type: String, trim: true },
    fromE164: { type: String, trim: true },
    toE164: { type: String, trim: true },
    callerName: { type: String, trim: true },
    status: { type: String, required: true },
    correlationId: { type: String, required: true, index: true },
    providerCallId: { type: String, trim: true },
    idempotencyKey: { type: String, trim: true, unique: true, sparse: true },
    recordingEnabled: { type: Boolean, default: true },
    timestamps: {
      receivedAt: { type: Date },
      answeredAt: { type: Date },
      connectedAt: { type: Date },
      playedAt: { type: Date },
      recordingStartedAt: { type: Date },
      hangupAt: { type: Date },
      completedAt: { type: Date },
      failedAt: { type: Date },
    },
    lastError: { type: String },
  },
  { timestamps: true },
);

export const CallModel = model<CallDocument>("Call", callSchema);
