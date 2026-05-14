// Minimal FIFO semaphore. One queue per process — used to cap how many
// embed/parse jobs run at once so resident memory stays predictable on 1 GB.
export class Semaphore {
  private inflight = 0;
  private waiters: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.inflight >= this.limit) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.inflight++;
    try {
      return await fn();
    } finally {
      this.inflight--;
      const next = this.waiters.shift();
      if (next) next();
    }
  }
}
