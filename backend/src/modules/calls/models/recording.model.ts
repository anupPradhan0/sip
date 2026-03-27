import { model, Schema, Types } from "mongoose";
import { CallProvider } from "./call.model";

export type RecordingStatus = "pending" | "completed" | "failed";

export interface RecordingDocument {
  _id: Types.ObjectId;
  callId: Types.ObjectId;
  provider: CallProvider;
  providerRecordingId: string;
  status: RecordingStatus;
  durationSec?: number;
  retrievalUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

const recordingSchema = new Schema<RecordingDocument>(
  {
    callId: { type: Schema.Types.ObjectId, ref: "Call", required: true, index: true },
    provider: { type: String, enum: ["sip-local", "twilio", "plivo"], required: true },
    providerRecordingId: { type: String, required: true, unique: true, index: true },
    status: { type: String, enum: ["pending", "completed", "failed"], default: "pending" },
    durationSec: { type: Number },
    retrievalUrl: { type: String },
  },
  { timestamps: true },
);

export const RecordingModel = model<RecordingDocument>("Recording", recordingSchema);
