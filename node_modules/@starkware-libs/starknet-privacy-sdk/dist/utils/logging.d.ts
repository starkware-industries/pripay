export type LogPhase = "ENTER" | "EXIT" | "ERROR";
/** Callback type for logging method calls */
export type LogCallback = (targetName: string, methodName: string, args: unknown[], result: unknown, // result or error
phase: LogPhase, traceId: string) => void;
/**
 * Wraps an object to intercept all method calls and invoke a callback.
 * Useful for debugging/logging.
 *
 * @param target - The object to wrap
 * @param name - Name to identify this object in logs
 * @param callback - Function called for each method invocation (with result after execution)
 */
export declare function withLogging<T extends object>(target: T, name: string, callback: LogCallback): T;
/** Environment variable to enable debug logging */
export declare const DEBUG_ENV_VAR = "SDK_DEBUG";
/** Check if debug logging is enabled */
export declare const isDebugEnabled: (targetName?: string) => boolean;
/**
 * Console logging callback for use with withLogging.
 * Logs method calls to console in format: [TraceID] [TargetName.method] -> (args)
 * Only logs when SDK_DEBUG environment variable is set.
 */
export declare const consoleLogCallback: LogCallback;
/**
 * Log arbitrary messages if debug is enabled for the target.
 * Function arguments are lazily evaluated - they're only called if debug is enabled.
 * This allows passing expensive computations like: debugLog("x", "y", "msg", () => expensiveCall())
 */
export declare const debugLog: (target: string, sub: string, ...args: unknown[]) => void;
/** No-op logging callback - does nothing */
export declare const noopLogCallback: LogCallback;
/** Helper message to show when tests fail */
export declare const debugHint = "\nTip: Run with SDK_DEBUG=1 for detailed logging";
//# sourceMappingURL=logging.d.ts.map