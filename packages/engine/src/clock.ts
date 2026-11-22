/**
 * Virtual simulated clock. All latency / settlement windows / block times
 * advance this clock — never wall-clock time, so runs are replayable.
 */
export class SimClock {
  private _t = 0;
  speed = 1;
  paused = false;

  get t(): number {
    return this._t;
  }

  now(): number {
    return this._t;
  }

  /** advance by virtual ms (scaled by nothing — caller passes virtual ms) */
  advance(ms: number): number {
    if (ms < 0) throw new Error("clock cannot go backwards");
    this._t += Math.round(ms);
    return this._t;
  }

  setSpeed(speed: number): void {
    if (!(speed >= 0.25 && speed <= 100)) throw new Error("speed out of range");
    this.speed = speed;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  reset(): void {
    this._t = 0;
    this.paused = false;
  }
}
