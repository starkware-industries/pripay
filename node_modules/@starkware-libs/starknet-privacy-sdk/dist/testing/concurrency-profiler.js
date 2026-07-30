/**
 * Concurrency Profiler - wraps an object to measure parallelism of async calls.
 *
 * Used to verify that discovery calls happen concurrently, not sequentially.
 * Adds artificial delay to make concurrency observable and measurable.
 */
/**
 * Creates a proxy around an object that tracks concurrent async calls.
 *
 * @param pool - The object to wrap (e.g., PoolContractInterface implementation)
 * @param delayMs - Artificial delay per call to simulate RPC latency (default: 20ms)
 * @returns Profiler with wrapped pool and getReport() method
 */
export function createConcurrencyProfiler(pool, delayMs = 20) {
    let concurrent = 0;
    let maxConcurrent = 0;
    const calls = [];
    const startTime = Date.now();
    const callKeys = new Set();
    const duplicates = [];
    const profiled = new Proxy(pool, {
        get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver);
            if (typeof value !== "function")
                return value;
            return async (...args) => {
                const callStart = Date.now();
                const concurrentAtStart = concurrent;
                concurrent++;
                maxConcurrent = Math.max(maxConcurrent, concurrent);
                // Track duplicates (handle BigInt serialization)
                const callKey = `${String(prop)}:${JSON.stringify(args, (_, v) => typeof v === "bigint" ? v.toString() : v)}`;
                if (callKeys.has(callKey)) {
                    duplicates.push(callKey);
                }
                callKeys.add(callKey);
                // Simulate RPC latency
                await new Promise((r) => setTimeout(r, delayMs));
                const result = await value.apply(target, args);
                concurrent--;
                calls.push({
                    method: String(prop),
                    args,
                    startTime: callStart - startTime,
                    endTime: Date.now() - startTime,
                    concurrentWith: concurrentAtStart,
                });
                return result;
            };
        },
    });
    return {
        pool: profiled,
        getReport: () => {
            const elapsed = Date.now() - startTime;
            const totalSleep = calls.length * delayMs;
            return {
                maxConcurrent,
                totalCalls: calls.length,
                elapsedMs: elapsed,
                totalSleepMs: totalSleep,
                parallelismFactor: totalSleep / elapsed,
                avgConcurrentAtCallStart: calls.length > 0 ? calls.reduce((s, c) => s + c.concurrentWith, 0) / calls.length : 0,
                calls,
                duplicates,
            };
        },
    };
}
/**
 * Format a concurrency report as a human-readable string.
 */
export function formatReport(report) {
    const lines = [
        `Parallelism Report:`,
        `  Total calls: ${report.totalCalls}`,
        `  Max concurrent: ${report.maxConcurrent}`,
        `  Elapsed: ${report.elapsedMs}ms`,
        `  Sequential would be: ${report.totalSleepMs}ms`,
        `  Parallelism factor: ${report.parallelismFactor.toFixed(2)}x`,
        `  Avg concurrent at call start: ${report.avgConcurrentAtCallStart.toFixed(2)}`,
    ];
    if (report.duplicates.length > 0) {
        lines.push(`  DUPLICATES: ${report.duplicates.length}`);
        for (const dup of report.duplicates.slice(0, 5)) {
            lines.push(`    - ${dup}`);
        }
        if (report.duplicates.length > 5) {
            lines.push(`    ... and ${report.duplicates.length - 5} more`);
        }
    }
    // Per-method breakdown
    const byMethod = new Map();
    for (const call of report.calls) {
        const existing = byMethod.get(call.method) ?? { count: 0, totalConcurrent: 0 };
        existing.count++;
        existing.totalConcurrent += call.concurrentWith;
        byMethod.set(call.method, existing);
    }
    if (byMethod.size > 0) {
        lines.push(`  Per-method breakdown:`);
        for (const [method, stats] of byMethod) {
            const avg = stats.totalConcurrent / stats.count;
            lines.push(`    ${method}: ${stats.count} calls, avg ${avg.toFixed(1)} concurrent`);
        }
    }
    return lines.join("\n");
}
//# sourceMappingURL=concurrency-profiler.js.map