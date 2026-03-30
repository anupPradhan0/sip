import Mrf, { MediaServer } from "drachtio-fsmrf";
import Srf from "drachtio-srf";

interface FreeswitchConfig {
  host: string;
  port: number;
  secret: string;
}

export class FreeswitchMrfService {
  private mrf: Mrf | null = null;
  private mediaServer: MediaServer | null = null;
  private config: FreeswitchConfig;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelayMs = 5000;
  private isConnecting = false;

  constructor(srf: Srf, config: FreeswitchConfig) {
    this.mrf = new Mrf(srf);
    this.config = config;
  }

  async connect(): Promise<MediaServer> {
    if (this.isConnecting) {
      throw new Error("Connection already in progress");
    }

    if (this.mediaServer) {
      console.log("Already connected to FreeSWITCH");
      return this.mediaServer;
    }

    this.isConnecting = true;

    try {
      const address = `${this.config.host}:${this.config.port}`;
      console.log(`Connecting to FreeSWITCH at ${address}...`);
      
      if (!this.mrf) {
        throw new Error("MRF not initialized");
      }

      const ms = await this.mrf.connect({
        address,
        secret: this.config.secret,
      });

      this.mediaServer = ms;
      this.reconnectAttempts = 0;
      
      console.log(`Connected to FreeSWITCH at ${ms.address}`);

      ms.on("ready", () => {
        console.log("FreeSWITCH media server ready");
      });

      ms.on("close", () => {
        console.warn("Lost connection to FreeSWITCH");
        this.mediaServer = null;
        this.scheduleReconnect();
      });

      ms.on("error", (err) => {
        console.error("FreeSWITCH media server error:", err);
      });

      return ms;
    } catch (error) {
      console.error("Failed to connect to FreeSWITCH:", error);
      this.mediaServer = null;
      this.scheduleReconnect();
      throw error;
    } finally {
      this.isConnecting = false;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`Max reconnect attempts (${this.maxReconnectAttempts}) reached. Giving up.`);
      return;
    }

    this.reconnectAttempts++;
    console.log(
      `Scheduling reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${this.reconnectDelayMs}ms`
    );

    setTimeout(() => {
      this.connect().catch((err) => {
        console.error("Reconnect failed:", err);
      });
    }, this.reconnectDelayMs);
  }

  getMediaServer(): MediaServer | null {
    return this.mediaServer;
  }

  isConnected(): boolean {
    return this.mediaServer !== null;
  }

  disconnect(): void {
    if (this.mediaServer && this.mrf) {
      console.log("Disconnecting from FreeSWITCH");
      this.mrf.disconnect(this.mediaServer);
      this.mediaServer = null;
    }
  }
}
