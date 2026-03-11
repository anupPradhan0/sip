// ari-client has no published @types package — this gives TypeScript enough info
// to compile without errors while keeping full runtime behaviour.
declare module 'ari-client' {
  export interface Channel {
    id: string;
    caller?: { number?: string; name?: string };
    answer(): Promise<void>;
    hangup(): Promise<void>;
    on(event: string, cb: (...args: unknown[]) => void): void;
  }

  export interface Client {
    on(event: 'StasisStart', cb: (event: unknown, channel: Channel) => void): void;
    on(event: 'StasisEnd',   cb: (event: unknown, channel: Channel) => void): void;
    on(event: string,        cb: (...args: unknown[]) => void): void;
    start(appName: string): void;
  }

  function connect(
    url: string,
    username: string,
    password: string
  ): Promise<Client>;

  export default { connect };
}
