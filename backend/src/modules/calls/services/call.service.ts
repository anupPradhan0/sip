import { randomUUID } from "node:crypto";
import { ApiError } from "../../../utils/api-error";
import { CallEventRepository } from "../repositories/call-event.repository";
import { CallRepository } from "../repositories/call.repository";
import { RecordingRepository } from "../repositories/recording.repository";
import { InboundHelloInput, OutboundHelloInput } from "../validators/call.schema";
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

  async runInboundHelloFlow(payload: InboundHelloInput): Promise<HelloFlowResult> {
    const correlationId = randomUUID();
    const now = new Date();
    const call = await this.callRepository.create({
      direction: "inbound",
      provider: payload.provider,
      from: payload.from,
      to: payload.to,
      status: "received",
      correlationId,
      providerCallId: payload.providerCallId,
      recordingEnabled: payload.recordingEnabled,
      timestamps: { receivedAt: now },
    });

    await this.pushEvent(call, "received", payload);

    await this.setStatus(call._id.toString(), "answered", { answeredAt: new Date() });
    await this.pushEvent(call, "answered");

    await this.setStatus(call._id.toString(), "played", { playedAt: new Date() });
    await this.pushEvent(call, "played", { message: "Hello from kulloo hello-call." });

    const recordings: RecordingDocument[] = [];
    if (payload.recordingEnabled) {
      await this.setStatus(call._id.toString(), "recording_started", { recordingStartedAt: new Date() });
      await this.pushEvent(call, "recording_started");
      const localRecordingId = `rec-inbound-${Date.now()}`;
      const recording = await this.recordingRepository.create({
        callId: call._id,
        provider: payload.provider,
        providerRecordingId: localRecordingId,
        status: "completed",
        durationSec: 3,
        retrievalUrl: `https://recordings.local/${localRecordingId}.wav`,
      });
      recordings.push(recording);
    }

    await this.setStatus(call._id.toString(), "hangup", { hangupAt: new Date() });
    await this.pushEvent(call, "hangup");

    const finalCall = await this.setStatus(call._id.toString(), "completed", { completedAt: new Date() });
    await this.pushEvent(call, "completed");

    return {
      call: finalCall,
      recordings,
    };
  }

  async runOutboundHelloFlow(payload: OutboundHelloInput, idempotencyKey: string): Promise<HelloFlowResult> {
    const existingCall = await this.callRepository.findByIdempotencyKey(idempotencyKey);
    if (existingCall) {
      return {
        call: existingCall,
        recordings: await this.recordingRepository.listByCallId(existingCall._id.toString()),
      };
    }

    const correlationId = randomUUID();
    const now = new Date();
    const call = await this.callRepository.create({
      direction: "outbound",
      provider: payload.provider,
      from: payload.from,
      to: payload.to,
      status: "initiated",
      correlationId,
      idempotencyKey,
      recordingEnabled: payload.recordingEnabled,
      timestamps: { receivedAt: now },
    });
    await this.pushEvent(call, "initiated", payload);

    try {
      const result = await this.telephonyAdapter.executeOutboundHello({
        provider: payload.provider,
        from: payload.from,
        to: payload.to,
        recordingEnabled: payload.recordingEnabled,
        message: "Hello from kulloo hello-call.",
      });

      await this.callRepository.setProviderCallId(call._id.toString(), result.providerCallId);
      await this.setStatus(call._id.toString(), this.mapConnectedStatus(payload.provider), {
        connectedAt: result.connectedAt,
      });
      await this.pushEvent(call, "connected", { providerCallId: result.providerCallId });

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

    const recordingsDir = process.env.RECORDINGS_DIR
      ? path.resolve(process.env.RECORDINGS_DIR)
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

    const recordingsDir = process.env.RECORDINGS_DIR
      ? path.resolve(process.env.RECORDINGS_DIR)
      : path.resolve(process.cwd(), "..", "recordings");
    const filePath = path.join(recordingsDir, `${input.callUuid}.wav`);

    try {
      await fs.stat(filePath);
    } catch {
      throw new ApiError("Recording file not found yet", 404);
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

    await this.callEventRepository.create({
      callId: call._id,
      correlationId: call.correlationId,
      eventType: "recording_completed",
      payload: { providerRecordingId: input.callUuid },
    });

    return recording;
  }

  private async setStatus(
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

  private async pushEvent(call: CallDocument, eventType: string, payload?: Record<string, unknown>): Promise<void> {
    await this.callEventRepository.create({
      callId: call._id,
      correlationId: call.correlationId,
      eventType,
      payload,
    });
  }

  private mapConnectedStatus(provider: CallProvider): CallStatus {
    return provider === "sip-local" ? "connected" : "connected";
  }
}
