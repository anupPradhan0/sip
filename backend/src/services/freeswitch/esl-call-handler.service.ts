import { Server as EslServer, Connection } from "modesl";
import { CallService } from "../../modules/calls/services/call.service";
import { randomUUID } from "crypto";
import path from "path";

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
    this.recordingsDir = options.recordingsDir || path.resolve(process.cwd(), "..", "recordings");
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

      conn.subscribe(["CHANNEL_ANSWER", "CHANNEL_HANGUP", "RECORD_STOP"], () => {
        console.log("Subscribed to ESL events");
      });

      conn.api("uuid_dump", (evt) => {
        const body = evt.getBody();
        
        const uuidMatch = body.match(/Channel-Call-UUID:\s*([^\s]+)/);
        const fromMatch = body.match(/Caller-Caller-ID-Number:\s*([^\s]+)/);
        const toMatch = body.match(/Caller-Destination-Number:\s*([^\s]+)/);
        
        callUuid = uuidMatch ? uuidMatch[1] : randomUUID();
        const from = fromMatch ? fromMatch[1] : "unknown";
        const to = toMatch ? toMatch[1] : "unknown";

        console.log(`Processing call ${callUuid} from ${from} to ${to}`);

        this.executeCallFlow(conn, callUuid, from, to).then((result) => {
          callId = result.callId;
          recordingPath = result.recordingPath;
        }).catch((err) => {
          console.error("Error executing call flow:", err);
        });
      });

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
    } catch (error) {
      console.error("Error in ESL connection handler:", error);
    }
  }

  private async executeCallFlow(conn: Connection, callUuid: string, from: string, to: string): Promise<{ callId: string; recordingPath: string }> {
    try {
      console.log(`Executing call flow for ${callUuid} (${from} -> ${to})`);

      const correlationId = randomUUID();
      const now = new Date();

      const call = await this.callService.callRepository.create({
        direction: "inbound",
        provider: "freeswitch",
        from,
        to,
        status: "received",
        correlationId,
        providerCallId: callUuid,
        recordingEnabled: true,
        timestamps: { receivedAt: now },
      });

      const callId = call._id.toString();

      await this.callService.pushEvent(call, "received", { from, to, callUuid });

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

      const recordingPath = path.join(this.recordingsDir, `${callUuid}.wav`);
      
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

      console.log(`Call flow setup completed for ${callUuid}`);
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
