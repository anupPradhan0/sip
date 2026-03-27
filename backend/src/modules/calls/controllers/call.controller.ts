import { NextFunction, Request, Response } from "express";
import { ApiError } from "../../../utils/api-error";
import { parseWithSchema } from "../../../utils/zod-validate";
import {
  callIdParamSchema,
  inboundHelloSchema,
  outboundHelloSchema,
  recordingIdParamSchema,
  twilioRecordingCallbackSchema,
} from "../validators/call.schema";
import { CallService } from "../services/call.service";

const callService = new CallService();

export async function inboundHelloCall(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const payload = parseWithSchema(inboundHelloSchema, req.body);
    const result = await callService.runInboundHelloFlow(payload);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

export async function outboundHelloCall(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const idempotencyKey = req.header("Idempotency-Key");
    if (!idempotencyKey) {
      throw new ApiError("Idempotency-Key header is required", 400);
    }

    const payload = parseWithSchema(outboundHelloSchema, req.body);
    const result = await callService.runOutboundHelloFlow(payload, idempotencyKey);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

export async function listCallRecordings(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { callId } = parseWithSchema(callIdParamSchema, req.params);
    const recordings = await callService.listRecordingsByCall(callId);
    res.status(200).json({ success: true, data: recordings });
  } catch (error) {
    next(error);
  }
}

export async function getRecording(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { recordingId } = parseWithSchema(recordingIdParamSchema, req.params);
    const recording = await callService.getRecordingById(recordingId);
    res.status(200).json({ success: true, data: recording });
  } catch (error) {
    next(error);
  }
}

export async function twilioRecordingCallback(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const payload = parseWithSchema(twilioRecordingCallbackSchema, req.body);
    const recording = await callService.ingestTwilioRecordingCallback(payload);
    res.status(200).json({ success: true, data: recording });
  } catch (error) {
    next(error);
  }
}
