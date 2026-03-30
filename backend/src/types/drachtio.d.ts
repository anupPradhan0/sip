declare module "drachtio-srf" {
  import { EventEmitter } from "events";

  export interface SrfOptions {
    host?: string;
    port?: number;
    secret?: string;
  }

  export interface SipRequest {
    method: string;
    uri: string;
    headers: Record<string, string>;
    body?: string;
    source_address?: string;
    source_port?: number;
    protocol?: string;
    get(header: string): string | undefined;
  }

  export interface SipResponse {
    status: number;
    reason: string;
    headers: Record<string, string>;
    body?: string;
  }

  export interface Dialog extends EventEmitter {
    sip: {
      callId: string;
      localTag: string;
      remoteTag: string;
    };
    local: {
      sdp: string;
      contact: string;
    };
    remote: {
      sdp: string;
      contact: string;
    };
    connected: boolean;
    connectTime?: Date;
    modify(sdp: string, opts?: { headers?: Record<string, string> }): Promise<void>;
    request(opts: {
      method: string;
      headers?: Record<string, string>;
      body?: string;
    }): Promise<SipResponse>;
    destroy(): void;
    on(event: "destroy", listener: () => void): this;
    on(event: "modify", listener: (req: SipRequest, res: SipResponse) => void): this;
    on(event: "refer", listener: (req: SipRequest, res: SipResponse) => void): this;
    on(event: "info", listener: (req: SipRequest, res: SipResponse) => void): this;
  }

  export class Srf extends EventEmitter {
    constructor(options?: SrfOptions);
    connect(options: SrfOptions): Promise<void>;
    disconnect(): void;
    on(event: "connect", listener: (err: Error | null, hostport: string) => void): this;
    on(event: "error", listener: (err: Error) => void): this;
    on(event: "invite", listener: (req: SipRequest, res: SipResponse) => void): this;
    invite(
      req: SipRequest,
      res: SipResponse,
      opts: { localSdp: string; headers?: Record<string, string> },
      callback: (err: Error | null, dialog: Dialog) => void
    ): void;
  }

  export function parseUri(uri: string): {
    family: string;
    schema: string;
    user?: string;
    password?: string;
    host: string;
    port?: number;
    params?: Record<string, string>;
    headers?: Record<string, string>;
  };

  export default Srf;
}

declare module "drachtio-fsmrf" {
  import { EventEmitter } from "events";
  import { Srf } from "drachtio-srf";

  export interface MediaServerOptions {
    address: string;
    secret: string;
  }

  export interface Endpoint extends EventEmitter {
    uuid: string;
    sip: {
      callId: string;
      localSdp: string;
      remoteSdp: string;
    };
    local: {
      sdp: string;
    };
    remote: {
      sdp: string;
    };
    connected: boolean;
    addr: {
      host: string;
      port: number;
    };
    
    execute(app: string, args?: string): Promise<{ body: string }>;
    api(command: string, args?: string): Promise<{ body: string }>;
    play(file: string | string[], opts?: Record<string, unknown>): Promise<{ event: string; reason?: string }>;
    bridge(target: Endpoint | string, opts?: Record<string, unknown>): Promise<void>;
    modify(sdp: string): Promise<{ sdp: string }>;
    destroy(): Promise<void>;
    
    on(event: "destroy", listener: () => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
    once(event: string, listener: (...args: unknown[]) => void): this;
    removeAllListeners(event?: string): this;
    addCustomEventListener(event: string, handler: (evt: Record<string, unknown>) => void): void;
    removeCustomEventListener(event: string): void;
  }

  export interface Conference extends EventEmitter {
    name: string;
    uuid: string;
    
    join(endpoint: Endpoint, opts?: Record<string, unknown>): Promise<{ memberId: string }>;
    destroy(): Promise<void>;
    
    on(event: "destroy", listener: () => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
  }

  export interface MediaServer extends EventEmitter {
    address: string;
    sip: {
      ipv4: {
        udp: { address: string; port: number };
        tcp?: { address: string; port: number };
      };
    };
    
    createEndpoint(opts?: { remoteSdp?: string; codecs?: string[] }): Promise<{ endpoint: Endpoint; dialog?: unknown }>;
    createConference(name: string, opts?: Record<string, unknown>): Promise<Conference>;
    connectCaller(req: unknown, res: unknown, opts: { remoteSdp: string }): Promise<{ endpoint: Endpoint; dialog: unknown }>;
    disconnect(): void;
    
    on(event: "ready", listener: () => void): this;
    on(event: "close", listener: () => void): this;
    on(event: "error", listener: (err: Error) => void): this;
  }

  export class Mrf {
    constructor(srf: Srf);
    connect(opts: MediaServerOptions): Promise<MediaServer>;
    disconnect(ms: MediaServer): void;
  }

  export default Mrf;
}

declare module "modesl" {
  import { EventEmitter } from "events";

  export interface ConnectionOptions {
    host?: string;
    port?: number;
    password?: string;
  }

  export interface EslEvent {
    getHeader(name: string): string | undefined;
    getBody(): string;
    getType(): string;
    serialize(): string;
  }

  export class Connection extends EventEmitter {
    constructor(host: string, port: number, password: string, callback?: () => void);
    constructor(options: ConnectionOptions, callback?: () => void);
    
    connected(): boolean;
    disconnect(): void;
    
    api(command: string, callback?: (res: EslEvent) => void): void;
    bgapi(command: string, callback?: (res: EslEvent) => void): void;
    execute(app: string, args?: string, callback?: (res: EslEvent) => void): void;
    executeAsync(app: string, args?: string, callback?: (res: EslEvent) => void): void;
    
    sendRecv(command: string, callback?: (res: EslEvent) => void): void;
    send(command: string, callback?: () => void): void;
    
    subscribe(events: string | string[], callback?: () => void): void;
    unsubscribe(events: string | string[], callback?: () => void): void;
    filter(header: string, value: string, callback?: () => void): void;
    filterDelete(header: string, value?: string, callback?: () => void): void;
    
    on(event: "esl::event::*", listener: (evt: EslEvent) => void): this;
    on(event: "esl::end", listener: () => void): this;
    on(event: "esl::ready", listener: () => void): this;
    on(event: "error", listener: (err: Error) => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
  }

  export class Server extends EventEmitter {
    constructor(options: { port: number; host?: string }, callback?: () => void);
    
    on(event: "connection::open", listener: (conn: Connection) => void): this;
    on(event: "connection::close", listener: (conn: Connection) => void): this;
    on(event: "error", listener: (err: Error) => void): this;
    
    close(): void;
  }
}
