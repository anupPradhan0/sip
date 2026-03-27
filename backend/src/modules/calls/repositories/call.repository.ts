import { Types } from "mongoose";
import { CallDocument, CallModel, CallStatus } from "../models/call.model";

export class CallRepository {
  async create(payload: Omit<CallDocument, "_id" | "createdAt" | "updatedAt">): Promise<CallDocument> {
    return CallModel.create(payload);
  }

  async findById(id: string): Promise<CallDocument | null> {
    if (!Types.ObjectId.isValid(id)) {
      return null;
    }
    return CallModel.findById(id);
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<CallDocument | null> {
    return CallModel.findOne({ idempotencyKey });
  }

  async findByProviderCallId(providerCallId: string): Promise<CallDocument | null> {
    return CallModel.findOne({ providerCallId });
  }

  async updateStatus(
    id: string,
    status: CallStatus,
    timestampsPatch: Record<string, Date>,
    lastError?: string,
  ): Promise<CallDocument | null> {
    if (!Types.ObjectId.isValid(id)) {
      return null;
    }

    return CallModel.findByIdAndUpdate(
      id,
      { status, $set: Object.fromEntries(Object.entries(timestampsPatch).map(([k, v]) => [`timestamps.${k}`, v])), lastError },
      { new: true, runValidators: true },
    );
  }

  async setProviderCallId(id: string, providerCallId: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) {
      return;
    }
    await CallModel.findByIdAndUpdate(id, { providerCallId });
  }
}
