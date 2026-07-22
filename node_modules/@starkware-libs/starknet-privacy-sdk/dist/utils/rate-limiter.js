/**
 * Concurrency limiter and retry utilities for async operations.
 * No external dependencies - browser/mobile compatible.
 */
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
export function createLimiter(concurrency) {
    let active = 0;
    const queue = [];
    const run = async (fn) => {
        // Wait if at capacity
        if (active >= concurrency) {
            await new Promise((resolve) => queue.push(resolve));
        }
        active++;
        try {
            return await fn();
        }
        finally {
            active--;
            // Wake up next queued task
            queue.shift()?.();
        }
    };
    return run;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
export function createRateLimitedObject(obj, options = {}) {
    const { concurrency = 8, maxRetries = 3, baseDelayMs = 100 } = options;
    const limit = createLimiter(concurrency);
    const withRetry = async (fn) => {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await fn();
            }
            catch (error) {
                if (attempt === maxRetries)
                    throw error;
                await sleep(baseDelayMs * Math.pow(2, attempt));
            }
        }
        throw new Error("Unreachable");
    };
    return new Proxy(obj, {
        get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver);
            if (typeof value === "function") {
                return (...args) => limit(() => withRetry(() => value.apply(target, args)));
            }
            return value;
        },
    });
}
//# sourceMappingURL=rate-limiter.js.map