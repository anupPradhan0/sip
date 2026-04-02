import { Server as EslServer, Connection } from "modesl";
import { CallService } from "../../modules/calls/services/call.service";
import { randomUUID } from "crypto";
import path from "path";
import { toE164BestEffort } from "../../utils/phone-normalize";
import fs from "node:fs/promises";
import { metrics } from "../observability/metrics.service";

export interface EslCallHandlerOptions {
  port: number;
  host?: string;
  recordingsDir?: string;
  mediaServer?: null;
}


export class EslCallHandlerService {
  private server: EslServer | null = null;
  private callService: CallService;
  private port: number;
  private host: string;
  private recordingsDir: string;
  private readonly activeProviderCallIds = new Set<string>();

  private log(
    ctx: { correlationId?: string; callId?: string; uuid?: string } | null,
    level: "info" | "error",
    message: string,
    extra?: unknown,
  ): void {
    const prefix = ctx
      ? `[corr=${ctx.correlationId ?? "-"} callId=${ctx.callId ?? "-"} uuid=${ctx.uuid ?? "-"}]`
      : "";
    if (level === "error") {
      // eslint-disable-next-line no-console
      console.error(prefix, message, extra ?? "");
    } else {
      // eslint-disable-next-line no-console
      console.log(prefix, message, extra ?? "");
    }
  }

  private static readonly ANSWER_TIMEOUT_MS = 5000;
  private static readonly PLAYBACK_TIMEOUT_MS = 15000;
  private static readonly SLEEP_TIMEOUT_MS = 25000;
  private static readonly STOP_RECORD_TIMEOUT_MS = 5000;
  private static readonly HANGUP_TIMEOUT_MS = 3000;
  private static readonly GETVAR_TIMEOUT_MS = 2000;

  private async withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async sendRecvAsync(
    conn: Connection,
    command: string,
  ): Promise<{ body: string; replyText?: string }> {
    return await new Promise<{ body: string; replyText?: string }>((resolve, reject) => {
      conn.sendRecv(command, (evt: unknown) => {
        const e = evt as { getBody?: () => unknown; getHeader?: (name: string) => unknown } | undefined;
        const body = typeof e?.getBody === "function" ? String(e.getBody() ?? "") : "";
        const replyTextRaw =
          typeof e?.getHeader === "function" ? e.getHeader("Reply-Text") : undefined;
        const replyText = typeof replyTextRaw === "string" ? replyTextRaw : undefined;
        const errText = (replyText && replyText.startsWith("-ERR")) ? replyText : (body && body.startsWith("-ERR") ? body : "");
        if (errText) return reject(new Error(errText));
        resolve({ body, replyText });
      });
    });
  }

  private async getVar(conn: Connection, name: string): Promise<string | null> {
    try {
      const { body, replyText } = await this.withTimeout(
        this.sendRecvAsync(conn, `getvar ${name}`),
        EslCallHandlerService.GETVAR_TIMEOUT_MS,
        `getvar ${name}`,
      );
      const raw = (body || replyText || "").trim();

      // FreeSWITCH commonly returns: "+OK <value>" in Reply-Text
      const text = (replyText ?? "").trim();
      if (text.startsWith("+OK")) {
        const val = text.slice(3).trim();
        if (!val || val === "_undef_" || val === "UNDEF") return null;
        return val;
      }

      // Sometimes value comes in body.
      if (!raw || raw === "_undef_" || raw === "UNDEF") return null;
      return raw;
    } catch {
      return null;
    }
  }

  private pickFirstNonEmpty(...values: Array<string | null | undefined>): string | null {
    for (const v of values) {
      if (v == null) continue;
      const s = String(v).trim();
      if (s) return s;
    }
    return null;
  }

  private parseChannelHeaders(
    getHeader: (name: string) => string | null,
  ): { callUuid: string; fromRaw: string | null; toRaw: string | null; callerName: string | null } {
    const callUuid =
      this.pickFirstNonEmpty(
        getHeader("Channel-Call-UUID"),
        getHeader("Unique-ID"),
        getHeader("variable_uuid"),
      ) ?? randomUUID();

    const fromRaw = this.pickFirstNonEmpty(
      getHeader("Caller-Caller-ID-Number"),
      getHeader("variable_effective_caller_id_number"),
      getHeader("variable_caller_id_number"),
      getHeader("variable_sip_from_user"),
      getHeader("variable_sip_p_asserted_identity"),
      getHeader("variable_sip_rpid"),
      getHeader("variable_sip_from_uri"),
      getHeader("variable_plivo_from"), // if present
    );

    const toRaw = this.pickFirstNonEmpty(
      getHeader("Caller-Destination-Number"),
      getHeader("variable_effective_callee_id_number"),
      getHeader("variable_destination_number"),
      getHeader("variable_sip_to_user"),
      getHeader("variable_sip_req_user"),
      getHeader("variable_sip_to_uri"),
      getHeader("variable_plivo_to"), // if present
    );

    const callerName = this.pickFirstNonEmpty(
      getHeader("Caller-Caller-ID-Name"),
      getHeader("variable_effective_caller_id_name"),
      getHeader("variable_caller_id_name"),
    );

    return { callUuid, fromRaw, toRaw, callerName };
  }

  private parseHeaderLines(lines: unknown): Record<string, string> {
    const out: Record<string, string> = {};
    const arr: unknown[] = Array.isArray(lines)
      ? lines
      : lines && typeof lines === "object"
        ? Object.values(lines as Record<string, unknown>)
        : [];
    if (!arr.length) return out;
    for (const item of arr) {
      const obj = (item && typeof item === "object") ? (item as Record<string, unknown>) : null;
      const raw = obj ? obj["raw"] : undefined;
      const str = typeof item === "string" ? item : typeof raw === "string" ? raw : null;
      if (!str) continue;
      const idx = str.indexOf(":");
      if (idx <= 0) continue;
      const key = str.slice(0, idx).trim();
      const val = str.slice(idx + 1).trim();
      if (!key) continue;
      out[key] = val;
    }
    return out;
  }

  private extractKullooCallId(headersObj: Record<string, unknown>): string | null {
    const candidates = Object.entries(headersObj)
      .filter(([k]) => k.toLowerCase().includes("kulloocallid"))
      .map(([, v]) => String(v ?? "").trim())
      .filter(Boolean);
    const val = candidates[0] ?? null;
    if (!val) return null;
    return /^[a-fA-F0-9]{24}$/.test(val) ? val : null;
  }

  private async execAndWait(conn: Connection, app: string, arg = "", timeoutMs?: number): Promise<void> {
    const ms = timeoutMs ?? EslCallHandlerService.PLAYBACK_TIMEOUT_MS;
    await new Promise<void>((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;
      const onComplete = (evt: unknown) => {
        try {
          const eslEvent = evt as { getHeader?: (name: string) => string | undefined };
          const getHeader = (name: string): string | undefined => (eslEvent.getHeader ? eslEvent.getHeader(name) : undefined);
          const application = getHeader("Application");
          const applicationData = getHeader("Application-Data");
          if (application !== app) return;
          if ((arg ?? "") && (applicationData ?? "") !== (arg ?? "")) return;
          conn.off("esl::event::CHANNEL_EXECUTE_COMPLETE::*", onComplete);
          if (timer) clearTimeout(timer);
          resolve();
        } catch (err) {
          conn.off("esl::event::CHANNEL_EXECUTE_COMPLETE::*", onComplete);
          if (timer) clearTimeout(timer);
          reject(err);
        }
      };

      conn.on("esl::event::CHANNEL_EXECUTE_COMPLETE::*", onComplete);

      timer = setTimeout(() => {
        conn.off("esl::event::CHANNEL_EXECUTE_COMPLETE::*", onComplete);
        reject(new Error(`Timeout after ${ms}ms: exec ${app} ${arg}`.trim()));
      }, ms);

      conn.execute(app, arg, (reply: unknown) => {
        const r = reply as { getBody?: () => unknown } | undefined;
        const body = typeof r?.getBody === "function" ? r.getBody() : "";
        if (typeof body === "string" && body.startsWith("-ERR")) {
          conn.off("esl::event::CHANNEL_EXECUTE_COMPLETE::*", onComplete);
          if (timer) clearTimeout(timer);
          reject(new Error(body));
        }
      });
    });
  }

  private waitForDtmf1(
    conn: Connection,
    timeoutMs: number,
    onDigit?: (digit: string) => void,
  ): Promise<"dtmf-1" | "timeout"> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (result: "dtmf-1" | "timeout") => {
        if (done) return;
        done = true;
        conn.off("esl::event::DTMF::*", onDtmf);
        conn.off("esl::event::CHANNEL_DTMF::*", onDtmf);
        clearTimeout(timer);
        resolve(result);
      };

      const onDtmf = (evt: unknown) => {
        const eslEvent = evt as { getHeader?: (name: string) => string | undefined };
        const digit =
          (eslEvent.getHeader ? eslEvent.getHeader("DTMF-Digit") : undefined) ??
          (eslEvent.getHeader ? eslEvent.getHeader("digit") : undefined) ??
          (eslEvent.getHeader ? eslEvent.getHeader("Key") : undefined);
        if (!digit) return;
        const d = String(digit).trim();
        onDigit?.(d);
        if (d === "1") finish("dtmf-1");
      };

      conn.on("esl::event::DTMF::*", onDtmf);
      conn.on("esl::event::CHANNEL_DTMF::*", onDtmf);

      const timer = setTimeout(() => finish("timeout"), timeoutMs);
    });
  }

  private async failAndHangup(input: {
    conn: Connection;
    callId?: string;
    stage: string;
    error: unknown;
  }): Promise<void> {
    const message = input.error instanceof Error ? input.error.message : String(input.error);
    this.log(null, "error", `Call failure at stage=${input.stage}: ${message}`, input.error);

    if (input.callId) {
      try {
        await this.callService.setStatus(input.callId, "failed", { failedAt: new Date() }, message);
      } catch (err) {
        this.log(null, "error", "Failed to set call status=failed", err);
      }

      try {
        const call = await this.callService.callRepository.findById(input.callId);
        if (call) {
          await this.callService.pushEvent(call, "failed", { stage: input.stage, error: message });
        }
      } catch (err) {
        this.log(null, "error", "Failed to push failed event", err);
      }
    }

    metrics.incCounter("failedCalls");

    // Best-effort hangup with timeout
    try {
      await this.execAndWait(input.conn, "hangup", "", EslCallHandlerService.HANGUP_TIMEOUT_MS);
    } catch (err) {
      this.log(null, "error", "Hangup attempt failed", err);
      try {
        input.conn.execute("hangup", "", () => {});
      } catch {
        // ignore
      }
    }
  }

  private attachDtmfLogger(conn: Connection, callId: string): () => void {
    // Both DTMF and CHANNEL_DTMF may fire; dedupe very close duplicates.
    let last: { digit: string; at: number } | null = null;

    const handler = (evt: unknown) => {
      const eslEvent = evt as { getHeader?: (name: string) => string | undefined };
      const digit =
        (eslEvent.getHeader ? eslEvent.getHeader("DTMF-Digit") : undefined) ??
        (eslEvent.getHeader ? eslEvent.getHeader("digit") : undefined) ??
        (eslEvent.getHeader ? eslEvent.getHeader("Key") : undefined);
      if (!digit) return;
      const d = String(digit).trim();
      if (!d) return;

      const now = Date.now();
      if (last && last.digit === d && now - last.at < 250) return;
      last = { digit: d, at: now };

      this.log(null, "info", `DTMF received: ${d}`);
      metrics.incCounter("dtmfCount");
      this.callService.callRepository.findById(callId).then((call) => {
        if (!call) return;
        return this.callService.pushEvent(call, "dtmf", { digit: d, at: new Date().toISOString() });
      }).catch((err) => {
        this.log(null, "error", "Failed to persist DTMF event", err);
      });
    };

    conn.on("esl::event::DTMF::*", handler);
    conn.on("esl::event::CHANNEL_DTMF::*", handler);

    return () => {
      conn.off("esl::event::DTMF::*", handler);
      conn.off("esl::event::CHANNEL_DTMF::*", handler);
    };
  }

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
      // Wait for connection ready and get initial channel data
      const connectDataFromInfo = await new Promise<{
        callUuid: string;
        fromRaw: string | null;
        toRaw: string | null;
        callerName: string | null;
        kullooCallId: string | null;
      }>((resolve) => {
        conn.on("esl::ready", () => {
          console.log("ESL connection ready");
          
          // In outbound mode, FreeSWITCH sends channel data immediately
          // Access it via getInfo() which returns the initial headers
          const info = (conn as unknown as { getInfo?: () => unknown }).getInfo?.();
          // modesl getInfo() varies by version; headers may be an array of header lines.
          const rawHeaders =
            info && typeof info === "object" && "headers" in info ? (info.headers as unknown) : (info as unknown);
          const headersObj =
            rawHeaders && typeof rawHeaders === "object" && !Array.isArray(rawHeaders)
              ? (rawHeaders as Record<string, unknown>)
              : this.parseHeaderLines(rawHeaders);
          console.log("Channel info received from FreeSWITCH");
          console.log("Available headers:", Object.keys(headersObj || {}).slice(0, 20).join(", "));

          // Parse headers from initial channel data
          const getHeader = (name: string): string | null => {
            return headersObj && headersObj[name] != null ? String(headersObj[name]) : null;
          };

          const parsed = this.parseChannelHeaders(getHeader);
          const kullooCallId = this.extractKullooCallId(headersObj);
          console.log(
            `Parsed(call-info) - UUID: ${parsed.callUuid}, From: ${parsed.fromRaw || "unknown"}, To: ${parsed.toRaw || "unknown"}, Name: ${parsed.callerName || "N/A"}`,
          );
          resolve({ ...parsed, kullooCallId });
        });
      });

      // Subscribe to channel events as early as possible
      conn.send("myevents");
      console.log("Subscribed to channel events with myevents");

      // Prefer CHANNEL_DATA (has full variables) if it arrives quickly.
      const connectData = await Promise.race([
        new Promise<{
          callUuid: string;
          fromRaw: string | null;
          toRaw: string | null;
          callerName: string | null;
          kullooCallId: string | null;
        }>((resolve) => {
          const onChannelData = (evt: unknown) => {
            const eslEvent = evt as { getHeader?: (name: string) => string | undefined };
            const getHeader = (name: string): string | null =>
              eslEvent.getHeader ? (eslEvent.getHeader(name) ?? null) : null;

            const parsed = this.parseChannelHeaders(getHeader);
            // If Plivo passed a SIP header, FreeSWITCH usually exposes it as `variable_sip_h_X-PH-KullooCallId`.
            const headersObj = this.parseHeaderLines((evt as any)?.headers ?? evt);
            const kullooCallId = this.extractKullooCallId(headersObj);
            console.log(
              `Parsed(CHANNEL_DATA) - UUID: ${parsed.callUuid}, From: ${parsed.fromRaw || "unknown"}, To: ${parsed.toRaw || "unknown"}, Name: ${parsed.callerName || "N/A"}`,
            );

            conn.off("esl::event::CHANNEL_DATA::*", onChannelData);
            resolve({ ...parsed, kullooCallId });
          };

          conn.on("esl::event::CHANNEL_DATA::*", onChannelData);
        }),
        new Promise<typeof connectDataFromInfo>((resolve) => setTimeout(() => resolve(connectDataFromInfo), 250)),
      ]);

      callUuid = connectData.callUuid;

      // Reliable fallback: query FreeSWITCH for vars if caller/callee still missing.
      // This avoids "unknown" when upstream SIP headers aren't present in the initial connect headers.
      // NOTE: in outbound event socket, prefer per-channel `getvar` over global `uuid_getvar`.
      let fromRaw = connectData.fromRaw;
      let toRaw = connectData.toRaw;
      let callerName = connectData.callerName;
      let kullooCallId = connectData.kullooCallId;

      if (!fromRaw) fromRaw = await this.getVar(conn, "effective_caller_id_number");
      if (!fromRaw) fromRaw = await this.getVar(conn, "caller_id_number");
      if (!fromRaw) fromRaw = await this.getVar(conn, "sip_from_user");

      if (!toRaw) toRaw = await this.getVar(conn, "destination_number");
      if (!toRaw) toRaw = await this.getVar(conn, "effective_callee_id_number");
      if (!toRaw) toRaw = await this.getVar(conn, "sip_to_user");
      if (!toRaw) toRaw = await this.getVar(conn, "sip_req_user");

      if (!callerName) callerName = await this.getVar(conn, "effective_caller_id_name");
      if (!callerName) callerName = await this.getVar(conn, "caller_id_name");

      // Correlation: try to fetch our custom Plivo SIP header as a channel var.
      if (!kullooCallId) {
        kullooCallId =
          (await this.getVar(conn, "sip_h_X-PH-KullooCallId")) ??
          (await this.getVar(conn, "sip_h_X_PH_KullooCallId")) ??
          (await this.getVar(conn, "variable_sip_h_X-PH-KullooCallId"));
        if (kullooCallId && !/^[a-fA-F0-9]{24}$/.test(kullooCallId)) {
          kullooCallId = null;
        }
      }

      // If our parsed UUID was random/incorrect, fetch the real per-channel UUID.
      const uuidFromVar = await this.getVar(conn, "uuid");
      if (uuidFromVar && uuidFromVar !== callUuid) {
        console.log(`UUID corrected via getvar uuid: ${callUuid} -> ${uuidFromVar}`);
        callUuid = uuidFromVar;
      }

      if (callUuid) {
        this.activeProviderCallIds.add(callUuid);
      }

      if (fromRaw || toRaw || callerName) {
        console.log(
          `Parsed(getvar) - UUID: ${callUuid}, From: ${fromRaw || "unknown"}, To: ${toRaw || "unknown"}, Name: ${callerName || "N/A"}`,
        );
      }

      const fromE164 = connectData.fromRaw ? toE164BestEffort(connectData.fromRaw) : undefined;
      const toE164 = connectData.toRaw ? toE164BestEffort(connectData.toRaw) : undefined;

      const finalFromE164 = fromRaw ? toE164BestEffort(fromRaw) : undefined;
      const finalToE164 = toRaw ? toE164BestEffort(toRaw) : undefined;

      console.log(
        `Processing call ${callUuid} from ${finalFromE164 || fromRaw || "unknown"} to ${finalToE164 || toRaw || "unknown"}`,
      );

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
        if (callUuid) {
          this.activeProviderCallIds.delete(callUuid);
        }
      });

      // Execute call flow
      const result = await this.executeCallFlow(conn, {
        callUuid: callUuid ?? connectData.callUuid,
        fromRaw,
        toRaw,
        fromE164: finalFromE164,
        toE164: finalToE164,
        callerName: callerName ?? undefined,
        kullooCallId,
      });
      
      callId = result.callId;
      recordingPath = result.recordingPath;
    } catch (error) {
      console.error("Error in ESL connection handler:", error);
      if (callUuid) {
        this.activeProviderCallIds.delete(callUuid);
      }
    }
  }

  getActiveProviderCallIds(): ReadonlySet<string> {
    return this.activeProviderCallIds;
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
      kullooCallId?: string | null;
    },
  ): Promise<{ callId: string; recordingPath: string }> {
    try {
      const from = input.fromE164 ?? input.fromRaw ?? "unknown";
      const to = input.toE164 ?? input.toRaw ?? "unknown";
      this.log(null, "info", `Executing call flow for ${input.callUuid} (${from} -> ${to})`);

      const now = new Date();
      const correlationId = randomUUID();

      // If this ESL session corresponds to an API-initiated outbound call, attach to that call record.
      let call: any = null;
      let created = false;
      const kullooCallId = input.kullooCallId && typeof input.kullooCallId === "string" ? input.kullooCallId : null;
      if (kullooCallId && /^[a-fA-F0-9]{24}$/.test(kullooCallId)) {
        const existing = await this.callService.callRepository.findById(kullooCallId);
        if (existing) {
          call = await this.callService.callRepository.updateById(existing._id.toString(), {
            provider: "freeswitch",
            providerCallId: input.callUuid,
            direction: "outbound",
            from,
            to,
            fromRaw: input.fromRaw ?? undefined,
            toRaw: input.toRaw ?? undefined,
            fromE164: input.fromE164,
            toE164: input.toE164,
            callerName: input.callerName,
          });
        }
      }

      if (!call) {
        const result = await this.callService.callRepository.findOrCreateByProviderCallId(
          "freeswitch",
          input.callUuid,
          {
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
          },
        );
        call = result.call;
        created = result.created;
      }

      const callId = call._id.toString();
      metrics.incActiveCalls();
      const ctx = { correlationId: call.correlationId, callId, uuid: input.callUuid };

      if (created) {
        await this.callService.pushEvent(call, "received", {
          from,
          to,
          fromRaw: input.fromRaw ?? undefined,
          toRaw: input.toRaw ?? undefined,
          fromE164: input.fromE164,
          toE164: input.toE164,
          callUuid: input.callUuid,
        });
      }

      await this.execAndWait(conn, "answer", "", EslCallHandlerService.ANSWER_TIMEOUT_MS);
      this.log(ctx, "info", "Call answered");

      await this.callService.setStatus(callId, "answered", { answeredAt: new Date() });
      await this.callService.pushEvent(call, "answered");

      await this.execAndWait(conn, "sleep", "500", 2000);
      this.log(ctx, "info", "Sleep 500ms complete");

      await this.execAndWait(
        conn,
        "playback",
        "tone_stream://%(1000,0,440)",
        EslCallHandlerService.PLAYBACK_TIMEOUT_MS,
      );
      this.log(ctx, "info", "Playback complete");

      await this.callService.setStatus(callId, "played", { playedAt: new Date() });
      await this.callService.pushEvent(call, "played", { message: "Tone played" });

      const recordingPath = path.join(path.resolve(this.recordingsDir), `${input.callUuid}.wav`);
      
      await this.callService.setStatus(callId, "recording_started", { recordingStartedAt: new Date() });
      await this.callService.pushEvent(call, "recording_started");

      // Create/Upsert a recording row immediately so every WAV has a DB record,
      // even if the backend restarts before RECORD_STOP is processed.
      const providerRecordingId = input.callUuid;
      const retrievalUrl = `/api/recordings/local/${providerRecordingId}`;
      const existingRecording = await this.callService.recordingRepository.findByProviderRecordingId(providerRecordingId);
      if (existingRecording) {
        await this.callService.recordingRepository.updateById(existingRecording._id.toString(), {
          status: "pending",
          filePath: recordingPath,
          retrievalUrl,
        });
      } else {
        await this.callService.recordingRepository.create({
          callId: call._id,
          provider: "freeswitch",
          providerRecordingId,
          status: "pending",
          filePath: recordingPath,
          retrievalUrl,
        });
      }

      conn.execute("record_session", recordingPath, () => {});
      this.log(ctx, "info", `Recording started: ${recordingPath}`);

      // Enable DTMF events so we can stop early on "1"
      conn.send("event plain DTMF");
      conn.send("event plain CHANNEL_DTMF");
      const detachDtmfLogger = this.attachDtmfLogger(conn, callId);

      const outcome = await Promise.race([
        this.waitForDtmf1(conn, 20000),
        (async () => {
          await this.execAndWait(conn, "sleep", "20000", EslCallHandlerService.SLEEP_TIMEOUT_MS);
          return "timeout" as const;
        })(),
      ]);

      if (outcome === "dtmf-1") {
        this.log(ctx, "info", "DTMF 1 received: stopping recording early");
      } else {
        this.log(ctx, "info", "Recording duration complete");
      }

      await this.execAndWait(conn, "stop_record_session", recordingPath, EslCallHandlerService.STOP_RECORD_TIMEOUT_MS);
      this.log(ctx, "info", "Recording stopped");

      if (outcome === "dtmf-1") {
        // Confirmation tone (no external sound files required)
        await this.execAndWait(conn, "playback", "tone_stream://%(200,0,880)", 5000);
      }

      detachDtmfLogger();
      // Hard hangup to enforce max duration; this matches the desired outbound behavior.
      await this.execAndWait(conn, "hangup", "", EslCallHandlerService.HANGUP_TIMEOUT_MS);
      this.log(ctx, "info", `Call flow setup completed for ${input.callUuid}`);
      metrics.decActiveCalls();
      return { callId, recordingPath };
    } catch (error) {
      // Handle failure: update DB + hangup; then rethrow so upstream logs also capture it.
      // Note: at this point we should always have a callId because we create/find it early.
      try {
        const existing = await this.callService.callRepository.findByProviderCallId(input.callUuid);
        await this.failAndHangup({
          conn,
          callId: existing?._id?.toString(),
          stage: "executeCallFlow",
          error,
        });
      } catch (err) {
        this.log(null, "error", "failAndHangup wrapper failed", err);
      }
      throw error;
    }
  }

  private async handleRecordingComplete(callId: string, callUuid: string, recordingPath: string): Promise<void> {
    try {
      const filePath = path.join(this.recordingsDir, `${callUuid}.wav`);
      
      const call = await this.callService.callRepository.findById(callId);
      if (!call) {
        this.log({ callId, uuid: callUuid }, "error", "Call not found for recording completion");
        return;
      }

      // Recording integrity: wait briefly for file flush and ensure non-trivial size.
      // WAV header is ~44 bytes; treat anything <= 44 bytes as invalid/empty.
      let st: { size: number } | null = null;
      for (let attempt = 1; attempt <= 10; attempt += 1) {
        try {
          const stat = await fs.stat(filePath);
          if (stat.size > 44) {
            st = { size: stat.size };
            break;
          }
        } catch {
          // file not there yet
        }
        await new Promise((r) => setTimeout(r, 200 * attempt));
      }

      const existing = await this.callService.recordingRepository.findByProviderRecordingId(callUuid);

      if (!st) {
        // If the file never materialized (early hangup/crash), mark recording failed but keep the row.
        if (existing) {
          await this.callService.recordingRepository.updateById(existing._id.toString(), {
            status: "failed",
            filePath,
            retrievalUrl: `/api/recordings/local/${callUuid}`,
          });
        } else {
          await this.callService.recordingRepository.create({
            callId: call._id,
            provider: "freeswitch",
            providerRecordingId: callUuid,
            status: "failed",
            filePath,
            retrievalUrl: `/api/recordings/local/${callUuid}`,
          });
        }
        await this.callService.callEventRepository.create({
          callId: call._id,
          correlationId: call.correlationId,
          eventType: "recording_failed",
          payload: { providerRecordingId: callUuid, reason: "file_missing_or_empty" },
        });
        metrics.incCounter("recordingFailed");
        this.log(
          { correlationId: call.correlationId, callId: call._id.toString(), uuid: callUuid },
          "error",
          `Recording file missing/empty after retries: ${filePath}`,
        );
        return;
      }

      const patch = {
        status: "completed" as const,
        durationSec: 20,
        filePath,
        retrievalUrl: `/api/recordings/local/${callUuid}`,
      };

      const recording =
        existing
          ? await this.callService.recordingRepository.updateById(existing._id.toString(), patch)
          : await this.callService.recordingRepository.create({
              callId: call._id,
              provider: "freeswitch",
              providerRecordingId: callUuid,
              status: "completed",
              durationSec: 20,
              filePath,
              retrievalUrl: `/api/recordings/local/${callUuid}`,
            });

      if (!recording) {
        this.log(
          { correlationId: call.correlationId, callId: call._id.toString(), uuid: callUuid },
          "error",
          "Failed to upsert recording metadata",
        );
        return;
      }

      // Only emit completion event once (avoid duplicates on retries).
      if (!existing || existing.status !== "completed") {
        await this.callService.callEventRepository.create({
          callId: call._id,
          correlationId: call.correlationId,
          eventType: "recording_completed",
          payload: { providerRecordingId: callUuid, recordingId: recording._id.toString() },
        });
      }

      this.log(
        { correlationId: call.correlationId, callId: call._id.toString(), uuid: callUuid },
        "info",
        "Recording metadata saved to MongoDB",
      );
    } catch (error) {
      this.log({ callId, uuid: callUuid }, "error", "Error handling recording completion", error);
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
