/**
 * TracingRpcProvider - Enhanced RPC provider that enriches errors with transaction traces
 *
 * When a transaction fails, this provider automatically fetches the execution trace
 * and decodes error messages and function selectors for easier debugging.
 */
import { RpcProvider, type RpcProviderOptions, type GetTransactionReceiptResponse, type TransactionTrace, type waitForTransactionOptions } from "starknet";
import { type DecodedError } from "../utils/error-decoder.js";
export type { DecodedError };
/**
 * Enhanced error that includes transaction trace and decoded information
 */
export declare class TracedRpcError extends Error {
    readonly originalError: Error;
    readonly transactionHash: string;
    readonly trace?: TransactionTrace | undefined;
    readonly decodedError?: DecodedError | undefined;
    readonly name = "TracedRpcError";
    constructor(originalError: Error, transactionHash: string, trace?: TransactionTrace | undefined, decodedError?: DecodedError | undefined);
}
/**
 * RPC Provider that automatically enriches errors with transaction traces.
 *
 * When waitForTransaction encounters a failed transaction, it will:
 * 1. Fetch the transaction trace
 * 2. Decode hex error messages and function selectors
 * 3. Throw a TracedRpcError with all debugging information
 */
export declare class TracingRpcProvider extends RpcProvider {
    constructor(options: RpcProviderOptions);
    /**
     * Wait for a transaction and enrich errors with traces on failure
     */
    waitForTransaction(txHash: string, options?: waitForTransactionOptions): Promise<GetTransactionReceiptResponse>;
    /**
     * Enrich an error with transaction trace and decoded information
     */
    private enrichError;
    /**
     * Extract revert reason from a transaction trace
     */
    private extractRevertReason;
    /**
     * Try to decode error message from an Error object
     */
    private tryDecodeErrorMessage;
}
//# sourceMappingURL=tracing-provider.d.ts.map