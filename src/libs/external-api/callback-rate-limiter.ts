/**
 * A simple rate limiter for callbacks that ensures a minimum time interval between calls
 */
export class CallbackRateLimiter {
  private lastCallTimes = new Map<string, number>()

  /**
   * Creates a new CallbackRateLimiter
   * @param {number} minIntervalMs - The minimum time (in milliseconds) that must pass between calls
   */
  constructor(private minIntervalMs: number) {}

  /**
   * Checks if enough time has passed to allow another call
   * @param {string} key - Unique identifier for the callback being rate limited
   * @returns {boolean} true if enough time has passed since the last call, false otherwise
   */
  public canCall(key: string): boolean {
    const now = Date.now()
    const lastCall = this.lastCallTimes.get(key) || 0
    const timeSinceLastCall = now - lastCall

    if (timeSinceLastCall >= this.minIntervalMs) {
      this.lastCallTimes.set(key, now)
      return true
    }

    return false
  }
}
