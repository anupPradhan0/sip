export type CounterName = "failedCalls" | "recordingFailed" | "dtmfCount";

export class MetricsService {
  private activeCalls = 0;
  private counters: Record<CounterName, number> = {
    failedCalls: 0,
    recordingFailed: 0,
    dtmfCount: 0,
  };

  incActiveCalls(): void {
    this.activeCalls += 1;
  }

  decActiveCalls(): void {
    this.activeCalls = Math.max(0, this.activeCalls - 1);
  }

  incCounter(name: CounterName, by = 1): void {
    this.counters[name] += by;
  }

  snapshot(): {
    activeCalls: number;
    failedCalls: number;
    recordingFailed: number;
    dtmfCount: number;
  } {
    return {
      activeCalls: this.activeCalls,
      failedCalls: this.counters.failedCalls,
      recordingFailed: this.counters.recordingFailed,
      dtmfCount: this.counters.dtmfCount,
    };
  }
}

export const metrics = new MetricsService();

