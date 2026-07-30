/**
 * Concurrency limiter and retry utilities for async operations.
 * No external dependencies - browser/mobile compatible.
 */
export type RateLimitOptions = {
    /** Maximum concurrent operations (default: 8) */
    concurrency?: number;
    /** Maximum retry attempts for failed operations (default: 3) */
    maxRetries?: number;
    /** Base delay in ms for exponential backoff (default: 100) */
    baseDelayMs?: number;
};
/**
 * Creates a concurrency limiter that restricts how many async operations
 * can run simultaneously.
 *
 * @param concurrency Maximum number of concurrent operations
 * @returns A function that wraps async operations with concurrency control
 *
 * @example
 * const limit = createLimiter(2);
 * // Only 2 of these will run at a time:
 * await Promise.all([
 *   limit(() => fetch('/a')),
 *   limit(() => fetch('/b')),
 *   limit(() => fetch('/c')),
 * ]);
 */
export declare function createLimiter(concurrency: number): <T>(fn: () => Promise<T>) => Promise<T>;
/**
 * Wraps an object (typically a contract interface) with rate limiting and retry logic.
 * All method calls on the returned proxy will be:
 * 1. Limited to `concurrency` simultaneous executions
 * 2. Retried with exponential backoff on failure
 *
 * @param obj The object to wrap
 * @param options Rate limiting and retry configuration
 * @returns A proxy with the same interface, but with rate limiting applied
 *
 * @example
 * const limitedPool = createRateLimitedPool(poolContract, { concurrency: 4 });
 * // Now all calls to limitedPool methods are rate-limited
 */
export declare function createRateLimitedObject<T extends object>(obj: T, options?: RateLimitOptions): T;
//# sourceMappingURL=rate-limiter.d.ts.map