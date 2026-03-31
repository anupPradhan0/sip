import { Server as EslServer, Connection } from "modesl";
import { CallService } from "../../modules/calls/services/call.service";
import { randomUUID } from "crypto";
import path from "path";
import { toE164BestEffort } from "../../utils/phone-normalize";

export interface EslCallHandlerOptions {
  port: number;
  host?: string;
  recordingsDir?: string;
  mediaServer: null;
}

export class EslCallHandlerService {
  private server: EslServer | null = null;
  private callService: CallService;
  private port: number;
  private host: string;
  private recordingsDir: string;

  constructor(options: EslCallHandlerOptions) {
    this.port = options.port;
    this.host = options.host || "0.0.0.0";
    this.recordingsDir = options.recordingsDir || "/recordings";
    this.callService = new CallService();
  }

  async listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = new EslServer({ port: this.port, host: this.host }, () => {
          console.log(`ESL outbound server listening on ${this.host}:${this.port}`);
          resolve();
        });

        this.server.on("connection::open", (conn: Connection) => {
          console.log("New ESL connection from FreeSWITCH");
          this.handleConnection(conn).catch((err) => {
            console.error("Error handling ESL connection:", err);
          });
        });

        this.server.on("connection::close", (conn: Connection) => {
          console.log("ESL connection closed");
        });

        this.server.on("error", (err: Error) => {
          console.error("ESL server error:", err);
          reject(err);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  private async handleConnection(conn: Connection): Promise<void> {
    let callUuid: string | null = null;
    let callId: string | null = null;
    let recordingPath: string | null = null;

    try {
      await new Promise<void>((resolve) => {
        conn.on("esl::ready", () => {
          console.log("ESL connection ready");
          resolve();
        });
      });

      // CRITICAL: Send 'connect' first - required for outbound event socket
      // FreeSWITCH waits for this command before allowing call control
      const connectData = await new Promise<{
        callUuid: string;
        fromRaw: string | null;
        toRaw: string | null;
        callerName: string | null;
      }>((resolve) => {
        conn.api("connect", (evt) => {
          const body = evt.getBody();
          console.log("Received connect response, parsing channel data...");
          console.log("Connect response body (first 1000 chars):", body.substring(0, 1000));

          // Parse headers from connect response
          const getHeader = (name: string): string | null => {
            const regex = new RegExp(`^${name}:\\s*(.*)$`, "m");
            const match = body.match(regex);
            return match ? match[1].trim() : null;
          };

          const uuid = getHeader("Channel-Call-UUID") || getHeader("Unique-ID") || randomUUID();
          
          const fromRaw =
            getHeader("variable_effective_caller_id_number") ||
            getHeader("Caller-Caller-ID-Number") ||
            getHeader("variable_caller_id_number") ||
            getHeader("variable_sip_from_user") ||
            null;

          const toRaw =
            getHeader("variable_effective_callee_id_number") ||
            getHeader("Caller-Destination-Number") ||
            getHeader("variable_destination_number") ||
            getHeader("variable_sip_to_user") ||
            getHeader("variable_sip_req_user") ||
            null;

          const callerName =
            getHeader("Caller-Caller-ID-Name") ||
            getHeader("variable_caller_id_name") ||
            getHeader("variable_effective_caller_id_name") ||
            null;

          console.log(`Parsed call - UUID: ${uuid}, From: ${fromRaw || "unknown"}, To: ${toRaw || "unknown"}`);
          resolve({ callUuid: uuid, fromRaw, toRaw, callerName });
        });
      });

      callUuid = connectData.callUuid;

      // Subscribe to events after connect
      conn.send("myevents");
      console.log("Subscribed to channel events with myevents");

      const fromE164 = connectData.fromRaw ? toE164BestEffort(connectData.fromRaw) : undefined;
      const toE164 = connectData.toRaw ? toE164BestEffort(connectData.toRaw) : undefined;

      console.log(`Processing call ${callUuid} from ${fromE164 || connectData.fromRaw || "unknown"} to ${toE164 || connectData.toRaw || "unknown"}`);

      // Set up event listeners before executing call flow
      conn.on("esl::event::RECORD_STOP::*", (evt: unknown) => {
        const eslEvent = evt as { getHeader: (name: string) => string | undefined };
        const recordFile = eslEvent.getHeader ? eslEvent.getHeader("Record-File-Path") : undefined;
        console.log("Recording stopped event received", recordFile);
        if (callId && callUuid && recordingPath) {
          this.handleRecordingComplete(callId, callUuid, recordingPath).catch((err) => {
            console.error("Error handling recording completion:", err);
          });
        }
      });

      conn.on("esl::event::CHANNEL_HANGUP::*", () => {
        console.log("Call hung up");
        if (callId) {
          this.callService.setStatus(callId, "hangup", { hangupAt: new Date() }).catch((err) => {
            console.error("Error updating call status to hangup:", err);
          });
          this.callService.setStatus(callId, "completed", { completedAt: new Date() }).catch((err) => {
            console.error("Error updating call status to completed:", err);
          });
        }
      });

      conn.on("esl::end", () => {
        console.log("ESL connection ended");
      });

      // Execute call flow
      const result = await this.executeCallFlow(conn, {
        callUuid: connectData.callUuid,
        fromRaw: connectData.fromRaw,
        toRaw: connectData.toRaw,
        fromE164,
        toE164,
        callerName: connectData.callerName ?? undefined,
      });
      
      callId = result.callId;
      recordingPath = result.recordingPath;
    } catch (error) {
      console.error("Error in ESL connection handler:", error);
    }
  }

  private async executeCallFlow(
    conn: Connection,
    input: {
      callUuid: string;
      fromRaw: string | null;
      toRaw: string | null;
      fromE164?: string;
      toE164?: string;
      callerName?: string;
    },
  ): Promise<{ callId: string; recordingPath: string }> {
    try {
      const from = input.fromE164 ?? input.fromRaw ?? "unknown";
      const to = input.toE164 ?? input.toRaw ?? "unknown";
      console.log(`Executing call flow for ${input.callUuid} (${from} -> ${to})`);

      const correlationId = randomUUID();
      const now = new Date();

      const call = await this.callService.callRepository.create({
        direction: "inbound",
        provider: "freeswitch",
        from,
        to,
        fromRaw: input.fromRaw ?? undefined,
        toRaw: input.toRaw ?? undefined,
        fromE164: input.fromE164,
        toE164: input.toE164,
        callerName: input.callerName,
        status: "received",
        correlationId,
        providerCallId: input.callUuid,
        recordingEnabled: true,
        timestamps: { receivedAt: now },
      });

      const callId = call._id.toString();

      await this.callService.pushEvent(call, "received", {
        from,
        to,
        fromRaw: input.fromRaw ?? undefined,
        toRaw: input.toRaw ?? undefined,
        fromE164: input.fromE164,
        toE164: input.toE164,
        callUuid: input.callUuid,
      });

      conn.execute("answer", "", () => {
        console.log("Call answered");
      });

      await this.callService.setStatus(callId, "answered", { answeredAt: new Date() });
      await this.callService.pushEvent(call, "answered");

      conn.execute("sleep", "500", () => {
        console.log("Sleep 500ms complete");
      });

      conn.execute("playback", "tone_stream://%(1000,0,440)", () => {
        console.log("Playback complete");
      });

      await this.callService.setStatus(callId, "played", { playedAt: new Date() });
      await this.callService.pushEvent(call, "played", { message: "Tone played" });

      const recordingPath = path.join(path.resolve(this.recordingsDir), `${input.callUuid}.wav`);
      
      await this.callService.setStatus(callId, "recording_started", { recordingStartedAt: new Date() });
      await this.callService.pushEvent(call, "recording_started");

      conn.execute("record_session", recordingPath, () => {
        console.log(`Recording started: ${recordingPath}`);
      });

      conn.execute("sleep", "20000", () => {
        console.log("Recording duration complete");
      });

      conn.execute("stop_record_session", recordingPath, () => {
        console.log("Recording stopped");
      });

      console.log(`Call flow setup completed for ${input.callUuid}`);
      return { callId, recordingPath };
    } catch (error) {
      console.error("Error in call flow execution:", error);
      throw error;
    }
  }

  private async handleRecordingComplete(callId: string, callUuid: string, recordingPath: string): Promise<void> {
    try {
      const filePath = path.join(this.recordingsDir, `${callUuid}.wav`);
      
      const call = await this.callService.callRepository.findById(callId);
      if (!call) {
        console.error(`Call ${callId} not found for recording completion`);
        return;
      }

      const recording = await this.callService.recordingRepository.create({
        callId: call._id,
        provider: "freeswitch",
        providerRecordingId: callUuid,
        status: "completed",
        durationSec: 20,
        filePath,
        retrievalUrl: `/api/recordings/local/${callUuid}`,
      });

      await this.callService.callEventRepository.create({
        callId: call._id,
        correlationId: call.correlationId,
        eventType: "recording_completed",
        payload: { providerRecordingId: callUuid, recordingId: recording._id.toString() },
      });

      console.log("Recording metadata saved to MongoDB");
    } catch (error) {
      console.error("Error handling recording completion:", error);
    }
  }

  close(): void {
    if (this.server) {
      console.log("Closing ESL outbound server");
      this.server.close();
      this.server = null;
    }
  }
}
