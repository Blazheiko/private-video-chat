export class TokenBucket {
  private tokens: number;
  private updated = Date.now();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
  ) {
    this.tokens = capacity;
  }

  take(cost = 1): boolean {
    const now = Date.now();
    const elapsedSeconds = (now - this.updated) / 1000;

    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillPerSec);
    this.updated = now;

    if (this.tokens < cost) {
      return false;
    }

    this.tokens -= cost;
    return true;
  }
}
