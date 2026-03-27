import { Types } from "mongoose";
import { CallEventDocument, CallEventModel } from "../models/call-event.model";

export class CallEventRepository {
  async create(payload: Omit<CallEventDocument, "createdAt" | "updatedAt">): Promise<CallEventDocument> {
    return CallEventModel.create(payload);
  }

  async listByCallId(callId: string): Promise<CallEventDocument[]> {
    if (!Types.ObjectId.isValid(callId)) {
      return [];
    }

    return CallEventModel.find({ callId }).sort({ createdAt: 1 });
  }
}
