// ═══════════════════════════════════════════════════════════
// MUNINN — Error Handling & Rate Limiter Tests
// ═══════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter, retryWithBackoff, LLMError } from '../core/errors.js';

describe('RateLimiter', () => {
  it('should allow requests within limits', () => {
    const limiter = new RateLimiter({ maxRequestsPerMinute: 5 });
    const check = limiter.canRequest();
    assert.equal(check.allowed, true);
  });

  it('should block requests over rate limit', () => {
    const limiter = new RateLimiter({ maxRequestsPerMinute: 3 });

    limiter.recordRequest();
    limiter.recordRequest();
    limiter.recordRequest();

    const check = limiter.canRequest();
    assert.equal(check.allowed, false);
    assert.ok(check.reason?.includes('Rate limit'));
  });

  it('should block requests over daily cost', () => {
    const limiter = new RateLimiter({ maxDailyCostUSD: 0.05 });

    limiter.recordRequest(0.03);
    limiter.recordRequest(0.03);

    const check = limiter.canRequest();
    assert.equal(check.allowed, false);
    assert.ok(check.reason?.includes('cost limit'));
  });

  it('should report status', () => {
    const limiter = new RateLimiter();
    limiter.recordRequest(0.01);
    limiter.recordRequest(0.02);

    const status = limiter.getStatus();
    assert.equal(status.requestsInWindow, 2);
    assert.equal(status.dailyCostUSD, 0.03);
  });
});

describe('retryWithBackoff', () => {
  it('should return result on success', async () => {
    const result = await retryWithBackoff(async () => 'hello');
    assert.equal(result, 'hello');
  });

  it('should retry on failure', async () => {
    let attempts = 0;
    const result = await retryWithBackoff(
      async () => {
        attempts++;
        if (attempts < 3) throw new Error('fail');
        return 'success';
      },
      { maxRetries: 3, baseDelayMs: 10 }
    );

    assert.equal(result, 'success');
    assert.equal(attempts, 3);
  });

  it('should not retry auth errors', async () => {
    let attempts = 0;
    await assert.rejects(
      retryWithBackoff(
        async () => {
          attempts++;
          throw new LLMError('Unauthorized', 401);
        },
        { maxRetries: 3, baseDelayMs: 10 }
      ),
      { name: 'LLMError' }
    );

    assert.equal(attempts, 1); // No retries
  });
});
