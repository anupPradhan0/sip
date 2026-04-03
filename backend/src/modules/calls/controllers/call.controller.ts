import { NextFunction, Request, Response } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { ApiError } from "../../../utils/api-error";
import { parseWithSchema } from "../../../utils/zod-validate";
import {
  callIdParamSchema,
  outboundHelloSchema,
  plivoRecordingCallbackQuerySchema,
  plivoRecordingCallbackSchema,
  recordingIdParamSchema,
  freeswitchRecordingCallbackSchema,
  twilioRecordingCallbackSchema,
} from "../validators/call.schema";
import { CallService } from "../services/call.service";

const callService = new CallService();

export async function listLocalRecordings(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const dir = path.resolve(process.env.RECORDINGS_DIR ?? "/recordings");

    let files: string[] = [];
    try {
      const entries = await fs.readdir(dir);
      files = entries.filter((f) => f.endsWith(".wav"));
    } catch {
      // Directory not mounted or empty — return empty list.
    }

    const recordings = files.map((f) => ({
      uuid: f.replace(/\.wav$/, ""),
      filename: f,
      url: `/api/recordings/local/${f.replace(/\.wav$/, "")}`,
    }));

    res.status(200).json({ success: true, count: recordings.length, data: recordings });
  } catch (error) {
    next(error);
  }
}

export async function localRecordingFile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const uuid = req.params.uuid?.replace(/\.wav$/i, "");
    if (!uuid || !/^[\w-]+$/.test(uuid)) {
      throw new ApiError("Invalid recording UUID", 400);
    }

    const dir = path.resolve(process.env.RECORDINGS_DIR ?? "/recordings");

    const filePath = path.join(dir, `${uuid}.wav`);

    try {
      await fs.stat(filePath);
    } catch {
      throw new ApiError("Recording file not found", 404);
    }

    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Content-Disposition", `inline; filename="${uuid}.wav"`);
    res.sendFile(filePath);
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

export async function getRecordingFile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { recordingId } = parseWithSchema(recordingIdParamSchema, req.params);
    const recording = await callService.getRecordingById(recordingId);

    if (!recording.filePath) {
      throw new ApiError("Recording file is not available", 404);
    }

    res.sendFile(path.resolve(recording.filePath));
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

export async function plivoRecordingCallback(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { callUuid } = parseWithSchema(plivoRecordingCallbackQuerySchema, req.query);
    const payload = parseWithSchema(plivoRecordingCallbackSchema, req.body);
    const recording = await callService.ingestPlivoRecordingCallback(callUuid, payload);
    res.status(200).json({ success: true, data: recording });
  } catch (error) {
    next(error);
  }
}

export async function freeswitchRecordingCallback(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const payload = parseWithSchema(freeswitchRecordingCallbackSchema, req.body);

    const durationSec =
      typeof payload.durationSec === "string" && payload.durationSec.trim().length > 0
        ? Number(payload.durationSec)
        : undefined;

    const recording = await callService.registerFreeswitchRecordingFromCallback({
      callUuid: payload.callUuid,
      durationSec,
      from: payload.from,
      to: payload.to,
    });

    res.status(200).json({ success: true, data: recording });
  } catch (error) {
    next(error);
  }
}
