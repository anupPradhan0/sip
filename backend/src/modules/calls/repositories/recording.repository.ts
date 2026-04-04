import { Types } from "mongoose";
import { RecordingDocument, RecordingModel, RecordingStatus } from "../models/recording.model";

export class RecordingRepository {
  async create(
    payload: Omit<RecordingDocument, "_id" | "createdAt" | "updatedAt">,
  ): Promise<RecordingDocument> {
    return RecordingModel.create(payload);
  }

  async findById(id: string): Promise<RecordingDocument | null> {
    if (!Types.ObjectId.isValid(id)) {
      return null;
    }
    return RecordingModel.findById(id);
  }

  async findByProviderRecordingId(providerRecordingId: string): Promise<RecordingDocument | null> {
    return RecordingModel.findOne({ providerRecordingId });
  }

  async listByCallId(callId: string): Promise<RecordingDocument[]> {
    if (!Types.ObjectId.isValid(callId)) {
      return [];
    }
    return RecordingModel.find({ callId }).sort({ createdAt: -1 });
  }

  async updateStatus(
    id: string,
    status: RecordingStatus,
    patch?: Partial<Pick<RecordingDocument, "durationSec" | "retrievalUrl">>,
  ): Promise<RecordingDocument | null> {
    if (!Types.ObjectId.isValid(id)) {
      return null;
    }
    return RecordingModel.findByIdAndUpdate(id, { status, ...patch }, { new: true, runValidators: true });
  }

  async updateById(
    id: string,
    patch: Partial<
      Pick<
        RecordingDocument,
        "providerRecordingId" | "status" | "durationSec" | "retrievalUrl" | "filePath"
      >
    >,
  ): Promise<RecordingDocument | null> {
    if (!Types.ObjectId.isValid(id)) {
      return null;
    }
    return RecordingModel.findByIdAndUpdate(id, patch, { new: true, runValidators: true });
  }

  async findPendingByCallId(callId: string): Promise<RecordingDocument | null> {
    if (!Types.ObjectId.isValid(callId)) {
      return null;
    }
    return RecordingModel.findOne({ callId, status: "pending" }).sort({ createdAt: -1 });
  }

  async upsertFreeswitchRecordingFromDiskSync(input: {
    providerRecordingId: string;
    callId: Types.ObjectId;
    filePath: string;
    retrievalUrl: string;
  }): Promise<void> {
    await RecordingModel.updateOne(
      { providerRecordingId: input.providerRecordingId },
      {
        $setOnInsert: {
          callId: input.callId,
          provider: "freeswitch",
          providerRecordingId: input.providerRecordingId,
        },
        $set: {
          status: "completed",
          filePath: input.filePath,
          retrievalUrl: input.retrievalUrl,
        },
      },
      { upsert: true },
    );
  }
}
