import { Types } from "mongoose";
import { CallDocument, CallModel, CallProvider, CallStatus } from "../models/call.model";

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

  async findOrCreateByProviderCallId(
    provider: CallProvider,
    providerCallId: string,
    payload: Omit<CallDocument, "_id" | "createdAt" | "updatedAt">,
  ): Promise<{ call: CallDocument; created: boolean }> {
    const existing = await CallModel.findOne({ provider, providerCallId });
    if (existing) return { call: existing, created: false };

    try {
      const created = await CallModel.create({ ...payload, provider, providerCallId });
      return { call: created, created: true };
    } catch (err: unknown) {
      // Handle race: two workers try to create same provider+providerCallId concurrently.
      const e = err as { code?: number } | undefined;
      if (e?.code === 11000) {
        const after = await CallModel.findOne({ provider, providerCallId });
        if (after) return { call: after, created: false };
      }
      throw err;
    }
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
