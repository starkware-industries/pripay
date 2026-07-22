/**
 * Standalone JSON-RPC client for the proving service (starknet_proveTransaction, etc.).
 * Structured similarly to starknet's RpcProvider.
 */
import type { BlockIdentifier } from "starknet";
import type { ProofInvocation } from "../interfaces.js";
import type { OhttpClient } from "./ohttp-client.js";
/** Default request timeout: 30s (proofs typically take a few seconds). */
export declare const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
/** Default number of retries after the initial attempt on a transient prove failure. */
export declare const DEFAULT_PROVE_MAX_RETRIES = 3;
/** Default base delay (ms) for exponential backoff between prove retries. */
export declare const DEFAULT_PROVE_BASE_DELAY_MS = 1000;
/**
 * Upper bound on a single backoff delay. Caps `baseDelayMs * 2^attempt` so a large
 * caller-supplied `maxRetries` can't schedule an unbounded (days-long) sleep.
 */
export declare const MAX_PROVE_BACKOFF_MS = 30000;
/**
 * Structured error from the proving service JSON-RPC endpoint.
 *
 * The `code` field is a numeric JSON-RPC error code that callers can switch on:
 *
 * **Prover codes (Starknet RPC v0.10):**
 * - `24`    — Block not found
 * - `55`    — Account validation failed
 * - `61`    — Unsupported transaction version
 * - `1000`  — Invalid transaction input
 * - `-32005` — Service busy (retry later)
 * - `-32603` — Internal prover error
 *
 * **Proxy interceptor codes (1xxxx range):**
 * - `10000` — Transaction rejected (e.g. screening/compliance)
 */
export declare class ProvingServiceError extends Error {
    readonly code: number;
    readonly data?: string | undefined;
    readonly name = "ProvingServiceError";
    constructor(code: number, message: string, data?: string | undefined);
}
/**
 * Error thrown when the proving service responds with a non-2xx HTTP status on
 * the plain-fetch transport. `status` lets callers (and the retry policy) branch
 * on the HTTP status; 503 (service unavailable) is treated as transient and retried.
 */
export declare class ProvingServiceHttpError extends Error {
    readonly status: number;
    readonly name = "ProvingServiceHttpError";
    constructor(status: number, body: string);
}
/**
 * Retry policy for transient proving-service failures — the prover returning
 * service-busy (`-32005`) or HTTP 503. Non-transient errors (invalid tx,
 * screening rejection, network failure) are never retried and surface immediately.
 *
 * Applies only to `proveTransaction`; `getSpecVersion`/`isHealthy` never retry so
 * health checks stay fast.
 *
 * Transport note: the service-busy `-32005` code is a JSON-RPC body error and is
 * retried on both the plain-fetch and OHTTP transports. The HTTP 503 case is only
 * retried on plain fetch — over OHTTP a 503 surfaces as a generic error from the
 * OHTTP layer (no status), so it is not classified as transient.
 */
export interface ProvingRetryOptions {
    /**
     * Maximum retries after the initial attempt. `0` disables retries (fail on the
     * first transient error). Default {@link DEFAULT_PROVE_MAX_RETRIES}.
     */
    maxRetries?: number;
    /**
     * Base delay in ms for exponential backoff: the wait before retry `attempt`
     * (0-indexed) is `baseDelayMs * 2^attempt` — e.g. 1s, 2s, 4s with the default.
     * Default {@link DEFAULT_PROVE_BASE_DELAY_MS}.
     */
    baseDelayMs?: number;
}
export interface ProvingServiceConfig {
    baseUrl: string;
    /** Request timeout in ms. Default 30_000 (30 seconds). */
    requestTimeoutMs?: number;
    /** When set, requests are encrypted via OHTTP instead of plain fetch. */
    ohttpClient?: OhttpClient;
    /**
     * Retry policy for transient (service-busy / HTTP 503) failures on
     * `proveTransaction`. Defaults to {@link DEFAULT_PROVE_MAX_RETRIES} retries
     * with {@link DEFAULT_PROVE_BASE_DELAY_MS} base backoff.
     */
    retry?: ProvingRetryOptions;
}
/** Result of starknet_proveTransaction. */
export interface ProveTransactionResult {
    /** Proof data: base64-encoded binary from the proving service. */
    proof: string;
    proof_facts: string[];
    l2_to_l1_messages: MessageToL1[];
    /**
     * Optional typed side-channel the prover attaches alongside the proof.
     * For screened deposits it carries the screening signature; absent for
     * transactions that need no attestation. Forward-compatible: new capabilities
     * add sibling keys without breaking existing consumers.
     */
    additional_data?: AdditionalData;
}
export interface MessageToL1 {
    from_address: string;
    to_address: string;
    payload: string[];
}
/**
 * Screening attestation produced by the FPI cloud function and relayed by the
 * proof interceptor / prover. The contract verifies it against the proven
 * deposit's `from_addr`.
 *
 * Felts are 0x-hex strings on the wire; `issued_at` is unix seconds.
 */
export interface ScreeningSignature {
    issued_at: number;
    sig_r: string;
    sig_s: string;
}
/** Typed `additional_data` side-channel on a prove response. */
export interface AdditionalData {
    signature?: ScreeningSignature;
}
export declare class ProvingService {
    private baseUrl;
    private requestTimeoutMs;
    private ohttpClient?;
    private readonly maxRetries;
    private readonly baseDelayMs;
    constructor(config: ProvingServiceConfig);
    /**
     * Single JSON-RPC call attempt (no retry). On a non-2xx HTTP response throws
     * {@link ProvingServiceHttpError}; on a JSON-RPC error body throws
     * {@link ProvingServiceError}.
     */
    private callOnce;
    /**
     * JSON-RPC call that retries transient failures (service-busy `-32005` or HTTP
     * 503) with exponential backoff per the configured {@link ProvingRetryOptions}.
     * Non-transient errors are rethrown on the first attempt.
     */
    private callWithRetry;
    getSpecVersion(): Promise<string>;
    proveTransaction(blockId: BlockIdentifier, transaction: ProofInvocation): Promise<ProveTransactionResult>;
    isHealthy(): Promise<boolean>;
}
//# sourceMappingURL=proving-service.d.ts.map