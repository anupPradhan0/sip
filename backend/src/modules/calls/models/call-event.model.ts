import { model, Schema, Types } from "mongoose";

export interface CallEventDocument {
  callId: Types.ObjectId;
  correlationId: string;
  eventType: string;
  payload?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const callEventSchema = new Schema<CallEventDocument>(
  {
    callId: { type: Schema.Types.ObjectId, ref: "Call", required: true, index: true },
    correlationId: { type: String, required: true, index: true },
    eventType: { type: String, required: true },
    payload: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

export const CallEventModel = model<CallEventDocument>("CallEvent", callEventSchema);
