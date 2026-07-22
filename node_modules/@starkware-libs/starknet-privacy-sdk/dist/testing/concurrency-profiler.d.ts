/**
 * Concurrency Profiler - wraps an object to measure parallelism of async calls.
 *
 * Used to verify that discovery calls happen concurrently, not sequentially.
 * Adds artificial delay to make concurrency observable and measurable.
 */
export type CallRecord = {
    method: string;
    args: unknown[];
    startTime: number;
    endTime: number;
    concurrentWith: number;
};
export type ConcurrencyReport = {
    maxConcurrent: number;
    totalCalls: number;
    elapsedMs: number;
    totalSleepMs: number;
    parallelismFactor: number;
    avgConcurrentAtCallStart: number;
    calls: CallRecord[];
    duplicates: string[];
};
export type ConcurrencyProfiler<T> = {
    pool: T;
    getReport: () => ConcurrencyReport;
};
/**
 * Creates a proxy around an object that tracks concurrent async calls.
 *
 * @param pool - The object to wrap (e.g., PoolContractInterface implementation)
 * @param delayMs - Artificial delay per call to simulate RPC latency (default: 20ms)
 * @returns Profiler with wrapped pool and getReport() method
 */
export declare function createConcurrencyProfiler<T extends object>(pool: T, delayMs?: number): ConcurrencyProfiler<T>;
/**
 * Format a concurrency report as a human-readable string.
 */
export declare function formatReport(report: ConcurrencyReport): string;
//# sourceMappingURL=concurrency-profiler.d.ts.map