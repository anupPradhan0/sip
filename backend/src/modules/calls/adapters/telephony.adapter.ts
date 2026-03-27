import { ApiError } from "../../../utils/api-error";
import { CallProvider } from "../models/call.model";

export interface OutboundExecutionResult {
  providerCallId: string;
  connectedAt: Date;
  playedAt: Date;
  recordingStartedAt?: Date;
  hangupAt: Date;
  completedAt: Date;
  recordingProviderId?: string;
  recordingStatus: "pending" | "completed" | "failed";
  retrievalUrl?: string;
}

export interface OutboundExecutionInput {
  provider: CallProvider;
  from: string;
  to: string;
  recordingEnabled: boolean;
  message: string;
}

export class TelephonyAdapter {
  async executeOutboundHello(input: OutboundExecutionInput): Promise<OutboundExecutionResult> {
    if (input.provider === "twilio") {
      return this.executeTwilioHello(input);
    }
    if (input.provider === "plivo") {
      return this.executePlivoHello(input);
    }
    return this.executeLocalSipHello(input);
  }

  private async executeLocalSipHello(input: OutboundExecutionInput): Promise<OutboundExecutionResult> {
    const now = new Date();
    const recordingId = `rec-local-${Date.now()}`;
    return {
      providerCallId: `sip-local-${Date.now()}`,
      connectedAt: now,
      playedAt: new Date(now.getTime() + 500),
      recordingStartedAt: input.recordingEnabled ? new Date(now.getTime() + 1000) : undefined,
      hangupAt: new Date(now.getTime() + 1500),
      completedAt: new Date(now.getTime() + 1500),
      recordingProviderId: input.recordingEnabled ? recordingId : undefined,
      recordingStatus: input.recordingEnabled ? "completed" : "failed",
      retrievalUrl: input.recordingEnabled
        ? `https://recordings.local/${recordingId}.wav`
        : undefined,
    };
  }

  private async executeTwilioHello(input: OutboundExecutionInput): Promise<OutboundExecutionResult> {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (!accountSid || !authToken) {
      throw new ApiError("Missing Twilio credentials for provider=twilio", 400);
    }

    const twilio = await import("twilio");
    const client = twilio.default(accountSid, authToken);

    const responseTwiml = input.recordingEnabled
      ? `<Response><Say>Hello from kulloo hello-call.</Say><Record maxLength="20" playBeep="false" /></Response>`
      : `<Response><Say>Hello from kulloo hello-call.</Say><Hangup /></Response>`;

    const call = await client.calls.create({
      from: input.from,
      to: input.to,
      twiml: responseTwiml,
    });

    const now = new Date();
    return {
      providerCallId: call.sid,
      connectedAt: now,
      playedAt: new Date(now.getTime() + 500),
      recordingStartedAt: input.recordingEnabled ? new Date(now.getTime() + 1000) : undefined,
      hangupAt: new Date(now.getTime() + 3000),
      completedAt: new Date(now.getTime() + 3000),
      recordingProviderId: input.recordingEnabled ? `pending-${call.sid}` : undefined,
      recordingStatus: input.recordingEnabled ? "pending" : "failed",
      retrievalUrl: undefined,
    };
  }

  private async executePlivoHello(input: OutboundExecutionInput): Promise<OutboundExecutionResult> {
    const authId = process.env.PLIVO_AUTH_ID;
    const authToken = process.env.PLIVO_AUTH_TOKEN;
    const answerUrl = process.env.PLIVO_ANSWER_URL;

    if (!authId || !authToken) {
      throw new ApiError("Missing Plivo credentials for provider=plivo", 400);
    }
    if (!answerUrl) {
      throw new ApiError("Missing PLIVO_ANSWER_URL for provider=plivo", 400);
    }

    const plivo = await import("plivo");
    const client = new plivo.Client(authId, authToken);

    const call = await client.calls.create(
      input.from,
      input.to,
      answerUrl,
      {
        answerMethod: "GET",
      },
    );

    const now = new Date();
    const requestUuid = typeof call?.requestUuid === "string" ? call.requestUuid : `plivo-${Date.now()}`;
    return {
      providerCallId: requestUuid,
      connectedAt: now,
      playedAt: new Date(now.getTime() + 500),
      recordingStartedAt: input.recordingEnabled ? new Date(now.getTime() + 1000) : undefined,
      hangupAt: new Date(now.getTime() + 3000),
      completedAt: new Date(now.getTime() + 3000),
      recordingProviderId: input.recordingEnabled ? `pending-${requestUuid}` : undefined,
      recordingStatus: input.recordingEnabled ? "pending" : "failed",
      retrievalUrl: undefined,
    };
  }
}
