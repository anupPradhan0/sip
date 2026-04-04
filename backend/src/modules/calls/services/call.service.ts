import { randomUUID } from "node:crypto";
import { Types } from "mongoose";
import { ApiError } from "../../../utils/api-error";
import { env } from "../../../config/env";
import { metrics } from "../../../services/observability/metrics.service";
import {
  peekCachedCallIdForIdempotencyKey,
  setCachedCallIdForIdempotencyKey,
} from "../../../services/redis/idempotency-cache.service";
import { CallEventRepository } from "../repositories/call-event.repository";
import { CallRepository } from "../repositories/call.repository";
import { RecordingRepository } from "../repositories/recording.repository";
import {
  OutboundHelloInput,
  PlivoRecordingCallbackPayload,
  TwilioRecordingCallbackPayload,
} from "../validators/call.schema";
import { claimRecordingWebhookOnce } from "../../../services/redis/webhook-dedupe.service";
import { TelephonyAdapter } from "../adapters/telephony.adapter";
import { CallDocument, CallProvider, CallStatus } from "../models/call.model";
import { RecordingDocument } from "../models/recording.model";
import path from "node:path";
import fs from "node:fs/promises";

interface HelloFlowResult {
  call: CallDocument;
  recordings: RecordingDocument[];
}

export class CallService {
  private readonly callRepository = new CallRepository();
  private readonly callEventRepository = new CallEventRepository();
  private readonly recordingRepository = new RecordingRepository();
  private readonly telephonyAdapter = new TelephonyAdapter();

  async runOutboundHelloFlow(payload: OutboundHelloInput, idempotencyKey: string): Promise<HelloFlowResult> {
    const cachedId = await peekCachedCallIdForIdempotencyKey(idempotencyKey);
    if (cachedId) {
      const fromCache = await this.callRepository.findById(cachedId);
      if (fromCache && fromCache.idempotencyKey === idempotencyKey) {
        metrics.incCounter("redisIdempotencyHits");
        return {
          call: fromCache,
          recordings: await this.recordingRepository.listByCallId(fromCache._id.toString()),
        };
      }
    }
    metrics.incCounter("redisIdempotencyMisses");

    const existingCall = await this.callRepository.findByIdempotencyKey(idempotencyKey);
    if (existingCall) {
      await setCachedCallIdForIdempotencyKey(idempotencyKey, existingCall._id.toString());
      return {
        call: existingCall,
        recordings: await this.recordingRepository.listByCallId(existingCall._id.toString()),
      };
    }

    const correlationId = randomUUID();
    const now = new Date();
    // Plivo+FreeSWITCH outbound: we only get the real FS channel UUID when ESL connects.
    // Mongo unique index { provider, providerCallId } treats multiple nulls as duplicates — use a stable placeholder until ESL patches it.
    // Stable spine (Jambonz call_sid): `_id` is created before Plivo dial and passed as KullooCallId on the SIP leg.
    const outboundId = new Types.ObjectId();
    const call = await this.callRepository.create({
      _id: outboundId,
      direction: "outbound",
      // Outbound PSTN via Plivo uses FreeSWITCH as the media/control plane.
      provider: payload.provider === "plivo" ? "freeswitch" : payload.provider,
      // Only set upstreamProvider together with upstreamCallId (unique index treats null upstreamCallId as duplicate).
      upstreamProvider: undefined,
      ...(payload.provider === "plivo" ? { providerCallId: `pending-${outboundId.toString()}` } : {}),
      from: payload.from,
      to: payload.to,
      status: "initiated",
      correlationId,
      idempotencyKey,
      recordingEnabled: payload.recordingEnabled,
      timestamps: { receivedAt: now },
    });
    await setCachedCallIdForIdempotencyKey(idempotencyKey, call._id.toString());
    await this.pushEvent(call, "initiated", payload);

    try {
      const result = await this.telephonyAdapter.executeOutboundHello({
        provider: payload.provider,
        from: payload.from,
        to: payload.to,
        recordingEnabled: payload.recordingEnabled,
        message: "Hello from kulloo hello-call.",
        kullooCallId: call.callSid ?? call._id.toString(),
      });

      if (payload.provider === "plivo") {
        await this.callRepository.updateById(call._id.toString(), {
          upstreamProvider: "plivo",
          upstreamCallId: result.providerCallId,
        });
        // Plivo only dials + bridges to FreeSWITCH; ESL owns answer/play/record/hangup/completed.
        // Do not simulate played/recording/hangup here — it races ESL and corrupts timestamps/status.
        await this.setStatus(call._id.toString(), this.mapConnectedStatus(payload.provider), {
          connectedAt: result.connectedAt,
        });
        await this.pushEvent(call, "connected", {
          upstreamCallId: result.providerCallId,
          note: "PSTN leg started; media handled by FreeSWITCH/ESL",
        });
        const finalCall = await this.callRepository.findById(call._id.toString());
        if (!finalCall) {
          throw new ApiError("Call not found after Plivo dial", 500);
        }
        return { call: finalCall, recordings: [] };
      }

      await this.callRepository.setProviderCallId(call._id.toString(), result.providerCallId);
      await this.setStatus(call._id.toString(), this.mapConnectedStatus(payload.provider), {
        connectedAt: result.connectedAt,
      });
      await this.pushEvent(call, "connected", {
        providerCallId: result.providerCallId,
      });

      await this.setStatus(call._id.toString(), "played", { playedAt: result.playedAt });
      await this.pushEvent(call, "played", { message: "Hello from kulloo hello-call." });

      const recordings: RecordingDocument[] = [];
      if (payload.recordingEnabled && result.recordingProviderId) {
        await this.setStatus(call._id.toString(), "recording_started", {
          recordingStartedAt: result.recordingStartedAt ?? new Date(),
        });
        await this.pushEvent(call, "recording_started", {
          providerRecordingId: result.recordingProviderId,
          status: result.recordingStatus,
        });

        const recording = await this.recordingRepository.create({
          callId: call._id,
          provider: payload.provider,
          providerRecordingId: result.recordingProviderId,
          status: result.recordingStatus,
          retrievalUrl: result.retrievalUrl,
        });
        recordings.push(recording);
      }

      await this.setStatus(call._id.toString(), "hangup", { hangupAt: result.hangupAt });
      await this.pushEvent(call, "hangup");

      const finalCall = await this.setStatus(call._id.toString(), "completed", {
        completedAt: result.completedAt,
      });
      await this.pushEvent(call, "completed");

      return { call: finalCall, recordings };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown outbound failure";
      await this.setStatus(call._id.toString(), "failed", { failedAt: new Date() }, message);
      await this.pushEvent(call, "failed", { error: message });
      throw error;
    }
  }

  async listRecordingsByCall(callId: string): Promise<RecordingDocument[]> {
    return this.recordingRepository.listByCallId(callId);
  }

  async getRecordingById(recordingId: string): Promise<RecordingDocument> {
    const recording = await this.recordingRepository.findById(recordingId);
    if (!recording) {
      throw new ApiError("Recording not found", 404);
    }
    return recording;
  }

  async ingestTwilioRecordingCallback(payload: {
    CallSid: string;
    RecordingSid: string;
    RecordingUrl?: string;
    RecordingDuration?: string;
    RecordingStatus?: string;
  }): Promise<RecordingDocument> {
    const call = await this.callRepository.findByProviderCallId(payload.CallSid);
    const existing = await this.recordingRepository.findByProviderRecordingId(payload.RecordingSid);
    if (existing) {
      const updated = await this.recordingRepository.updateStatus(existing._id.toString(), "completed", {
        durationSec: Number(payload.RecordingDuration ?? 0),
        retrievalUrl: payload.RecordingUrl,
      });
      if (!updated) {
        throw new ApiError("Unable to update recording", 500);
      }
      return updated;
    }

    if (!call) {
      throw new ApiError("Call not found for recording callback", 404);
    }

    return this.recordingRepository.create({
      callId: call._id,
      provider: "twilio",
      providerRecordingId: payload.RecordingSid,
      status: "completed",
      durationSec: Number(payload.RecordingDuration ?? 0),
      retrievalUrl: payload.RecordingUrl,
    });
  }

  async ingestPlivoRecordingCallback(
    callUuid: string,
    payload: {
      RecordingID: string;
      RecordUrl?: string;
      RecordingDuration?: string;
      RecordingDurationMs?: string;
    },
  ): Promise<RecordingDocument> {
    const call = await this.callRepository.findByProviderCallId(callUuid);
    if (!call) {
      throw new ApiError("Call not found for Plivo recording callback", 404);
    }

    const existingByProviderId = await this.recordingRepository.findByProviderRecordingId(payload.RecordingID);
    if (existingByProviderId) {
      const updated = await this.recordingRepository.updateById(existingByProviderId._id.toString(), {
        status: "completed",
        retrievalUrl: payload.RecordUrl,
        durationSec: Number(payload.RecordingDuration ?? 0),
      });
      if (!updated) {
        throw new ApiError("Unable to update Plivo recording", 500);
      }
      return updated;
    }

    const pending = await this.recordingRepository.findPendingByCallId(call._id.toString());
    if (pending) {
      const updated = await this.recordingRepository.updateById(pending._id.toString(), {
        providerRecordingId: payload.RecordingID,
        status: "completed",
        retrievalUrl: payload.RecordUrl,
        durationSec: Number(payload.RecordingDuration ?? 0),
      });
      if (!updated) {
        throw new ApiError("Unable to finalize Plivo recording", 500);
      }
      return updated;
    }

    return this.recordingRepository.create({
      callId: call._id,
      provider: "plivo",
      providerRecordingId: payload.RecordingID,
      status: "completed",
      retrievalUrl: payload.RecordUrl,
      durationSec: Number(payload.RecordingDuration ?? 0),
    });
  }

  async registerFreeswitchRecording(callUuid: string): Promise<RecordingDocument> {
    const call = await this.callRepository.findByProviderCallId(callUuid);
    if (!call) {
      throw new ApiError("Call not found", 404);
    }

    const recordingsDir = env.recordingsDirRaw
      ? path.resolve(env.recordingsDirRaw)
      : path.resolve(process.cwd(), "..", "recordings");
    const filePath = path.join(recordingsDir, `${callUuid}.wav`);

    try {
      await fs.stat(filePath);
    } catch {
      throw new ApiError("Recording file not found yet", 404);
    }

    const recording = await this.recordingRepository.create({
      callId: call._id,
      provider: "freeswitch",
      providerRecordingId: callUuid,
      status: "completed",
      filePath,
      retrievalUrl: `/api/recordings/local/${callUuid}`,
    });

    return recording;
  }

  async registerFreeswitchRecordingFromCallback(input: {
    callUuid: string;
    durationSec?: number;
    from?: string;
    to?: string;
  }): Promise<RecordingDocument> {
    // Avoid duplicate creation if FreeSWITCH retries the webhook.
    const existing = await this.recordingRepository.findByProviderRecordingId(input.callUuid);
    if (existing) {
      return existing;
    }

    let call = await this.callRepository.findByProviderCallId(input.callUuid);

    // FreeSWITCH callbacks can arrive without a prior "hello-call" API call,
    // so we create a minimal Call record to satisfy the recording linkage.
    if (!call) {
      const correlationId = randomUUID();
      const now = new Date();
      call = await this.callRepository.create({
        direction: "inbound",
        provider: "freeswitch",
        from: input.from ?? "unknown",
        to: input.to ?? "unknown",
        status: "completed",
        correlationId,
        providerCallId: input.callUuid,
        recordingEnabled: true,
        timestamps: {
          receivedAt: now,
          completedAt: now,
        },
        lastError: undefined,
      });

      // eslint-disable-next-line no-console
      console.log(`Created freeswitch Call for recording callback callUuid=${input.callUuid}`);
    }

    const recordingsDir = env.recordingsDirRaw
      ? path.resolve(env.recordingsDirRaw)
      : path.resolve(process.cwd(), "..", "recordings");
    const filePath = path.join(recordingsDir, `${input.callUuid}.wav`);

    // Retry up to 10 times (5 seconds total) to handle race condition where
    // the webhook arrives before FreeSWITCH finishes writing the WAV file.
    const maxRetries = 10;
    const retryDelayMs = 500;
    let fileFound = false;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await fs.stat(filePath);
        fileFound = true;
        break;
      } catch {
        if (attempt < maxRetries) {
          // eslint-disable-next-line no-console
          console.log(`Recording file not found yet, retry ${attempt}/${maxRetries} for ${input.callUuid}`);
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        }
      }
    }

    if (!fileFound) {
      throw new ApiError(`Recording file not found after ${maxRetries} retries: ${filePath}`, 404);
    }

    const recording = await this.recordingRepository.create({
      callId: call._id,
      provider: "freeswitch",
      providerRecordingId: input.callUuid,
      status: "completed",
      durationSec: input.durationSec,
      filePath,
      retrievalUrl: `/api/recordings/local/${input.callUuid}`,
    });

    await this.pushEvent(call, "recording_completed", { providerRecordingId: input.callUuid });

    return recording;
  }

  async setStatus(
    callId: string,
    status: CallStatus,
    timestampsPatch: Record<string, Date>,
    lastError?: string,
  ): Promise<CallDocument> {
    const updated = await this.callRepository.updateStatus(callId, status, timestampsPatch, lastError);
    if (!updated) {
      throw new ApiError("Call not found", 404);
    }
    return updated;
  }

  async pushEvent(call: CallDocument | { _id: unknown; correlationId: string }, eventType: string, payload?: Record<string, unknown>): Promise<void> {
    await this.callEventRepository.create({
      callId: call._id as Types.ObjectId,
      correlationId: call.correlationId,
      eventType,
      payload,
    });
  }

  private mapConnectedStatus(provider: CallProvider): CallStatus {
    return provider === "sip-local" ? "connected" : "connected";
  }

  async listLocalWavSummaries(): Promise<Array<{ uuid: string; filename: string; url: string }>> {
    const dir = path.resolve(env.recordingsDirRaw ?? "/recordings");
    let files: string[] = [];
    try {
      const entries = await fs.readdir(dir);
      files = entries.filter((f) => f.endsWith(".wav"));
    } catch {
      // Directory not mounted or empty — return empty list.
    }
    return files.map((f) => ({
      uuid: f.replace(/\.wav$/, ""),
      filename: f,
      url: `/api/recordings/local/${f.replace(/\.wav$/, "")}`,
    }));
  }

  async resolveLocalRecordingAbsolutePath(uuidRaw: string): Promise<string> {
    const uuid = uuidRaw?.replace(/\.wav$/i, "");
    if (!uuid || !/^[\w-]+$/.test(uuid)) {
      throw new ApiError("Invalid recording UUID", 400);
    }
    const dir = path.resolve(env.recordingsDirRaw ?? "/recordings");
    const filePath = path.join(dir, `${uuid}.wav`);
    try {
      await fs.stat(filePath);
    } catch {
      throw new ApiError("Recording file not found", 404);
    }
    return filePath;
  }

  async processTwilioRecordingWebhook(
    payload: TwilioRecordingCallbackPayload,
  ): Promise<{ duplicate: true } | { duplicate: false; recording: RecordingDocument }> {
    const first = await claimRecordingWebhookOnce("twilio", [payload.CallSid, payload.RecordingSid]);
    if (!first) {
      metrics.incCounter("webhookDedupeSkips");
      return { duplicate: true };
    }
    const recording = await this.ingestTwilioRecordingCallback(payload);
    return { duplicate: false, recording };
  }

  async processPlivoRecordingWebhook(
    callUuid: string,
    payload: PlivoRecordingCallbackPayload,
  ): Promise<{ duplicate: true } | { duplicate: false; recording: RecordingDocument }> {
    const first = await claimRecordingWebhookOnce("plivo", [callUuid, payload.RecordingID]);
    if (!first) {
      metrics.incCounter("webhookDedupeSkips");
      return { duplicate: true };
    }
    const recording = await this.ingestPlivoRecordingCallback(callUuid, payload);
    return { duplicate: false, recording };
  }

  async processFreeswitchRecordingWebhook(input: {
    callUuid: string;
    durationSec?: number;
    from?: string;
    to?: string;
  }): Promise<{ duplicate: true } | { duplicate: false; recording: RecordingDocument }> {
    const first = await claimRecordingWebhookOnce("freeswitch", [input.callUuid]);
    if (!first) {
      metrics.incCounter("webhookDedupeSkips");
      return { duplicate: true };
    }
    const recording = await this.registerFreeswitchRecordingFromCallback(input);
    return { duplicate: false, recording };
  }

  // --- ESL / FreeSWITCH: delegate persistence without exposing repositories ---

  async findCallDocumentById(callId: string): Promise<CallDocument | null> {
    return this.callRepository.findById(callId);
  }

  async findCallDocumentByStableCallId(stableCallId: string): Promise<CallDocument | null> {
    return this.callRepository.findByStableCallId(stableCallId);
  }

  async updateCallDocument(id: string, patch: Partial<CallDocument>): Promise<CallDocument | null> {
    return this.callRepository.updateById(id, patch);
  }

  async findOrCreateCallByProviderCallId(
    provider: CallProvider,
    providerCallId: string,
    payload: Omit<CallDocument, "_id" | "createdAt" | "updatedAt">,
  ): Promise<{ call: CallDocument; created: boolean }> {
    return this.callRepository.findOrCreateByProviderCallId(provider, providerCallId, payload);
  }

  async findCallDocumentByProviderCallId(providerCallId: string): Promise<CallDocument | null> {
    return this.callRepository.findByProviderCallId(providerCallId);
  }

  async findRecordingDocumentByProviderRecordingId(
    providerRecordingId: string,
  ): Promise<RecordingDocument | null> {
    return this.recordingRepository.findByProviderRecordingId(providerRecordingId);
  }

  async updateRecordingDocument(
    id: string,
    patch: Parameters<RecordingRepository["updateById"]>[1],
  ): Promise<RecordingDocument | null> {
    return this.recordingRepository.updateById(id, patch);
  }

  async createRecordingDocument(
    payload: Omit<RecordingDocument, "_id" | "createdAt" | "updatedAt">,
  ): Promise<RecordingDocument> {
    return this.recordingRepository.create(payload);
  }
}
