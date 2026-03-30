import { Endpoint } from "drachtio-fsmrf";
import { randomUUID } from "crypto";
import path from "path";

export interface RecordingMetadata {
  callUuid: string;
  filePath: string;
  durationSec?: number;
  from?: string;
  to?: string;
}

export type DtmfCallback = (digit: string) => void | Promise<void>;

export class CallControlService {
  private recordingsDir: string;

  constructor(recordingsDir?: string) {
    this.recordingsDir = recordingsDir || path.resolve(process.cwd(), "..", "recordings");
  }

  async answerCall(endpoint: Endpoint): Promise<void> {
    console.log(`Answering call on endpoint ${endpoint.uuid}`);
    await endpoint.execute("answer");
  }

  async playTone(endpoint: Endpoint, frequency: number = 440, duration: number = 1000): Promise<void> {
    console.log(`Playing tone ${frequency}Hz for ${duration}ms on endpoint ${endpoint.uuid}`);
    const toneString = `tone_stream://%(${duration},0,${frequency})`;
    
    try {
      await endpoint.play(toneString);
    } catch (error) {
      console.error("Error playing tone:", error);
      throw error;
    }
  }

  async playAudio(endpoint: Endpoint, audioPath: string): Promise<void> {
    console.log(`Playing audio ${audioPath} on endpoint ${endpoint.uuid}`);
    
    try {
      await endpoint.play(audioPath);
    } catch (error) {
      console.error("Error playing audio:", error);
      throw error;
    }
  }

  async startRecording(
    endpoint: Endpoint,
    callUuid?: string,
    onComplete?: (metadata: RecordingMetadata) => void | Promise<void>
  ): Promise<string> {
    const uuid = callUuid || randomUUID();
    const fileName = `${uuid}.wav`;
    const filePath = path.join(this.recordingsDir, fileName);

    console.log(`Starting recording for call ${uuid} to ${filePath}`);

    endpoint.execute("record_session", filePath);

    if (onComplete) {
      const handleRecordingStop = (evt: Record<string, unknown>) => {
        console.log(`Recording stopped for call ${uuid}`, evt);
        
        const metadata: RecordingMetadata = {
          callUuid: uuid,
          filePath,
          durationSec: evt.duration_sec ? Number(evt.duration_sec) : undefined,
        };

        Promise.resolve(onComplete(metadata)).catch((err) => {
          console.error("Error in recording completion handler:", err);
        });
      };

      endpoint.addCustomEventListener("record::stop", handleRecordingStop);
    }

    return filePath;
  }

  async stopRecording(endpoint: Endpoint, filePath: string): Promise<void> {
    console.log(`Stopping recording on endpoint ${endpoint.uuid}: ${filePath}`);
    
    try {
      await endpoint.execute("stop_record_session", filePath);
    } catch (error) {
      console.error("Error stopping recording:", error);
      throw error;
    }
  }

  async sleep(endpoint: Endpoint, milliseconds: number): Promise<void> {
    console.log(`Sleeping for ${milliseconds}ms on endpoint ${endpoint.uuid}`);
    await endpoint.execute("sleep", String(milliseconds));
  }

  detectDTMF(endpoint: Endpoint, callback: DtmfCallback): void {
    console.log(`Setting up DTMF detection on endpoint ${endpoint.uuid}`);

    const handleDtmf = (...args: unknown[]) => {
      const evt = args[0] as Record<string, unknown> | undefined;
      if (!evt) return;
      
      const digit = evt.digit || evt["DTMF-Digit"];
      if (digit) {
        console.log(`DTMF detected on ${endpoint.uuid}: ${digit}`);
        Promise.resolve(callback(String(digit))).catch((err) => {
          console.error("Error in DTMF callback:", err);
        });
      }
    };

    endpoint.on("dtmf", handleDtmf);
    endpoint.addCustomEventListener("dtmf", handleDtmf);
  }

  async hangup(endpoint: Endpoint): Promise<void> {
    console.log(`Hanging up endpoint ${endpoint.uuid}`);
    
    try {
      await endpoint.execute("hangup");
    } catch (error) {
      console.error("Error hanging up:", error);
    }
  }

  async bridgeEndpoints(endpoint1: Endpoint, endpoint2: Endpoint): Promise<void> {
    console.log(`Bridging endpoints ${endpoint1.uuid} and ${endpoint2.uuid}`);
    await endpoint1.bridge(endpoint2);
  }

  async destroyEndpoint(endpoint: Endpoint): Promise<void> {
    console.log(`Destroying endpoint ${endpoint.uuid}`);
    
    try {
      endpoint.removeAllListeners();
      await endpoint.destroy();
    } catch (error) {
      console.error("Error destroying endpoint:", error);
    }
  }

  async getVariable(endpoint: Endpoint, variableName: string): Promise<string | undefined> {
    try {
      const result = await endpoint.api("uuid_getvar", `${endpoint.uuid} ${variableName}`);
      return result.body?.trim();
    } catch (error) {
      console.error(`Error getting variable ${variableName}:`, error);
      return undefined;
    }
  }

  async setVariable(endpoint: Endpoint, variableName: string, value: string): Promise<void> {
    try {
      await endpoint.execute("set", `${variableName}=${value}`);
    } catch (error) {
      console.error(`Error setting variable ${variableName}:`, error);
      throw error;
    }
  }
}
