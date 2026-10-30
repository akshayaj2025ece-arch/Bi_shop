/**
 * Server-side Network Resilience Utility for BISHOP.
 * Implements Topic 11 (Timeouts), Topic 12 (Retries), and Topic 13 (Exponential Backoff with Jitter).
 */

if (typeof window !== "undefined") {
  throw new Error("Security Error: server-only module '@/server/common/resilience' cannot be executed in browser context.");
}

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterFactor?: number;
  operationName?: string;
  isRetryable?: (error: any) => boolean;
}

/**
 * Wraps a promise with a hard timeout to prevent indefinite hangs.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number = 8000,
  operationName: string = "Operation"
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`Timeout: ${operationName} exceeded execution limit of ${ms}ms.`));
    }, ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutHandle!);
  }
}

/**
 * Evaluates whether an error is transient and safe to retry.
 * Permanent validation (4xx), authorization (401/403), and constraint errors are NOT retryable.
 */
export function isRetryableNetworkError(error: any): boolean {
  if (!error) return false;

  const msg = String(error?.message || error).toLowerCase();
  const code = String(error?.code || "");
  const status = Number(error?.status || 0);

  // Connection dropouts, socket hangs, DNS timeouts
  if (
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("enotfound") ||
    msg.includes("fetch failed") ||
    msg.includes("network error") ||
    msg.includes("socket hang up") ||
    msg.includes("rate limit")
  ) {
    return true;
  }

  // HTTP transient statuses (429 Too Many Requests, 502 Bad Gateway, 503 Service Unavailable, 504 Gateway Timeout)
  if (status === 429 || status === 502 || status === 503 || status === 504) {
    return true;
  }

  // PostgREST connection / pool exhaustion codes
  if (code === "57014" || code === "53300" || code === "08006" || code === "08001") {
    return true;
  }

  return false;
}

/**
 * Executes an async operation with bounded exponential backoff, full jitter,
 * and strict retry limits to prevent retry storms.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelayMs = 200,
    maxDelayMs = 2500,
    jitterFactor = 0.5,
    operationName = "Operation",
    isRetryable = isRetryableNetworkError,
  } = options;

  let attempt = 0;
  let lastError: any;

  while (attempt <= maxRetries) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      attempt++;

      if (attempt > maxRetries || !isRetryable(err)) {
        break;
      }

      // Exponential backoff: base * 2^(attempt - 1)
      const exponential = baseDelayMs * Math.pow(2, attempt - 1);
      const capped = Math.min(exponential, maxDelayMs);
      // Full jitter: random delay between (1 - jitter) and (1 + jitter) of capped
      const jitter = capped * (1 - jitterFactor + Math.random() * (jitterFactor * 2));
      const delay = Math.round(Math.min(jitter, maxDelayMs));

      console.warn(
        `[RETRY] ${operationName} failed (attempt ${attempt}/${maxRetries}): ${err?.message || err}. Retrying in ${delay}ms...`
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
