// ═══════════════════════════════════════════════════════════
// MUNINN — Error Handling
// Graceful failures — a raven must survive storms
// ═══════════════════════════════════════════════════════════

/** Base error class for Muninn */
export class MuninnError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly recoverable: boolean = true,
  ) {
    super(message);
    this.name = 'MuninnError';
  }
}

/** Configuration errors */
export class ConfigError extends MuninnError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR', false);
    this.name = 'ConfigError';
  }
}

/** LLM API errors */
export class LLMError extends MuninnError {
  constructor(message: string, public readonly statusCode?: number) {
    super(message, 'LLM_ERROR', true);
    this.name = 'LLMError';
  }

  get isRateLimit(): boolean {
    return this.statusCode === 429;
  }

  get isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }
}

/** Memory/storage errors */
export class MemoryError extends MuninnError {
  constructor(message: string) {
    super(message, 'MEMORY_ERROR', true);
    this.name = 'MemoryError';
  }
}

/** Rate limiter — prevent runaway API costs */
export class RateLimiter {
  private requests: number[] = [];
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private totalCost: number = 0;
  private readonly maxDailyCost: number;
  private costResetAt: number;

  constructor(options: {
    maxRequestsPerMinute?: number;
    maxDailyCostUSD?: number;
  } = {}) {
    this.maxRequests = options.maxRequestsPerMinute || 20;
    this.windowMs = 60_000; // 1 minute
    this.maxDailyCost = options.maxDailyCostUSD || 5.0;
    this.costResetAt = Date.now() + 24 * 60 * 60 * 1000;
  }

  /** Check if a request is allowed */
  canRequest(): { allowed: boolean; reason?: string; retryAfterMs?: number } {
    this.cleanup();

    // Check rate limit
    if (this.requests.length >= this.maxRequests) {
      const oldestInWindow = this.requests[0];
      const retryAfterMs = oldestInWindow + this.windowMs - Date.now();
      return {
        allowed: false,
        reason: `Rate limit: ${this.maxRequests} requests/minute exceeded`,
        retryAfterMs,
      };
    }

    // Check daily cost
    if (this.totalCost >= this.maxDailyCost) {
      return {
        allowed: false,
        reason: `Daily cost limit of $${this.maxDailyCost} reached. Resets at ${new Date(this.costResetAt).toLocaleTimeString()}`,
      };
    }

    return { allowed: true };
  }

  /** Record a request */
  recordRequest(estimatedCostUSD: number = 0.01): void {
    this.requests.push(Date.now());
    this.totalCost += estimatedCostUSD;

    // Reset daily cost if past reset time
    if (Date.now() > this.costResetAt) {
      this.totalCost = 0;
      this.costResetAt = Date.now() + 24 * 60 * 60 * 1000;
    }
  }

  /** Clean up old request timestamps */
  private cleanup(): void {
    const cutoff = Date.now() - this.windowMs;
    this.requests = this.requests.filter(t => t > cutoff);
  }

  /** Get current status */
  getStatus(): { requestsInWindow: number; dailyCostUSD: number } {
    this.cleanup();
    return {
      requestsInWindow: this.requests.length,
      dailyCostUSD: Math.round(this.totalCost * 100) / 100,
    };
  }
}

/** Retry with exponential backoff */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    onRetry?: (attempt: number, error: Error) => void;
  } = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelay = options.baseDelayMs ?? 1000;
  const maxDelay = options.maxDelayMs ?? 30000;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry auth errors
      if (error instanceof LLMError && error.isAuthError) {
        throw error;
      }

      if (attempt < maxRetries) {
        const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
        const jitter = delay * 0.1 * Math.random();
        options.onRetry?.(attempt + 1, lastError);
        await new Promise(resolve => setTimeout(resolve, delay + jitter));
      }
    }
  }

  throw lastError;
}
