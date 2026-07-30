/**
 * Standalone JSON-RPC client for the proving service (starknet_proveTransaction, etc.).
 * Structured similarly to starknet's RpcProvider.
 */
import { z } from "zod";
/** Default request timeout: 30s (proofs typically take a few seconds). */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
/** Default number of retries after the initial attempt on a transient prove failure. */
export const DEFAULT_PROVE_MAX_RETRIES = 3;
/** Default base delay (ms) for exponential backoff between prove retries. */
export const DEFAULT_PROVE_BASE_DELAY_MS = 1_000;
/**
 * Upper bound on a single backoff delay. Caps `baseDelayMs * 2^attempt` so a large
 * caller-supplied `maxRetries` can't schedule an unbounded (days-long) sleep.
 */
export const MAX_PROVE_BACKOFF_MS = 30_000;
/** JSON-RPC error code the prover returns when it is temporarily overloaded ("retry later"). */
const SERVICE_BUSY_CODE = -32005;
/** HTTP status codes treated as transient (worth retrying) on the plain-fetch transport. */
const TRANSIENT_HTTP_STATUS = new Set([503]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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
export class ProvingServiceError extends Error {
    code;
    data;
    name = "ProvingServiceError";
    constructor(code, message, data) {
        super(data ? `${message}: ${data}` : message);
        this.code = code;
        this.data = data;
    }
}
/**
 * Error thrown when the proving service responds with a non-2xx HTTP status on
 * the plain-fetch transport. `status` lets callers (and the retry policy) branch
 * on the HTTP status; 503 (service unavailable) is treated as transient and retried.
 */
export class ProvingServiceHttpError extends Error {
    status;
    name = "ProvingServiceHttpError";
    constructor(status, body) {
        super(`Proving service HTTP ${status}: ${body}`);
        this.status = status;
    }
}
const MessageToL1Schema = z
    .object({
    from_address: z.string(),
    to_address: z.string(),
    payload: z.array(z.string()),
})
    .strict();
const ScreeningSignatureSchema = z
    .object({
    issued_at: z.number(),
    sig_r: z.string(),
    sig_s: z.string(),
})
    .strict();
const AdditionalDataSchema = z
    .object({
    signature: ScreeningSignatureSchema.optional(),
})
    .strict();
const ProveTransactionResultSchema = z
    .object({
    proof: z.string().min(1),
    proof_facts: z.array(z.string()),
    l2_to_l1_messages: z.array(MessageToL1Schema),
    additional_data: AdditionalDataSchema.optional(),
})
    .strict();
export class ProvingService {
    baseUrl;
    requestTimeoutMs;
    ohttpClient;
    maxRetries;
    baseDelayMs;
    constructor(config) {
        this.baseUrl = config.baseUrl;
        this.requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
        this.ohttpClient = config.ohttpClient;
        this.maxRetries = config.retry?.maxRetries ?? DEFAULT_PROVE_MAX_RETRIES;
        this.baseDelayMs = config.retry?.baseDelayMs ?? DEFAULT_PROVE_BASE_DELAY_MS;
    }
    /**
     * Single JSON-RPC call attempt (no retry). On a non-2xx HTTP response throws
     * {@link ProvingServiceHttpError}; on a JSON-RPC error body throws
     * {@link ProvingServiceError}.
     */
    async callOnce(method, params) {
        const body = {
            jsonrpc: "2.0",
            id: Date.now(),
            method,
            params,
        };
        let json;
        if (this.ohttpClient) {
            json = await this.ohttpClient.post("", body);
        }
        else {
            const res = await fetch(this.baseUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
                // Per-attempt timeout: each retry gets a fresh budget, so worst-case wall
                // time on a hung connection is (maxRetries + 1) * requestTimeoutMs plus backoff.
                signal: AbortSignal.timeout(this.requestTimeoutMs),
            });
            const text = await res.text();
            if (!res.ok) {
                throw new ProvingServiceHttpError(res.status, text);
            }
            json = JSON.parse(text);
        }
        if (json.error) {
            const { code, message, data } = json.error;
            throw new ProvingServiceError(code, message, typeof data === "string" ? data : undefined);
        }
        const result = json.result;
        if (result === undefined) {
            throw new Error("Proving service returned no result");
        }
        return result;
    }
    /**
     * JSON-RPC call that retries transient failures (service-busy `-32005` or HTTP
     * 503) with exponential backoff per the configured {@link ProvingRetryOptions}.
     * Non-transient errors are rethrown on the first attempt.
     */
    async callWithRetry(method, params) {
        for (let attempt = 0;; attempt++) {
            try {
                return await this.callOnce(method, params);
            }
            catch (error) {
                if (attempt >= this.maxRetries || !isTransientError(error)) {
                    throw error;
                }
                await sleep(Math.min(this.baseDelayMs * 2 ** attempt, MAX_PROVE_BACKOFF_MS));
            }
        }
    }
    async getSpecVersion() {
        return this.callOnce("starknet_specVersion", []);
    }
    async proveTransaction(blockId, transaction) {
        const blockIdParam = typeof blockId === "number" || typeof blockId === "bigint"
            ? { block_number: Number(blockId) }
            : blockId;
        const result = await this.callWithRetry("starknet_proveTransaction", {
            block_id: blockIdParam,
            transaction,
        });
        const parsed = ProveTransactionResultSchema.safeParse(result);
        if (!parsed.success) {
            const snippet = typeof result === "object" && result !== null
                ? JSON.stringify(result).slice(0, 500)
                : String(result);
            throw new Error(`Proving service returned invalid result: expected { proof, proof_facts, l2_to_l1_messages }. ${parsed.error.message} Response: ${snippet}`);
        }
        return parsed.data;
    }
    async isHealthy() {
        try {
            await this.getSpecVersion();
            return true;
        }
        catch {
            return false;
        }
    }
}
/** Whether an error from a single prove attempt is transient and worth retrying. */
function isTransientError(error) {
    if (error instanceof ProvingServiceError) {
        return error.code === SERVICE_BUSY_CODE;
    }
    if (error instanceof ProvingServiceHttpError) {
        return TRANSIENT_HTTP_STATUS.has(error.status);
    }
    return false;
}
//# sourceMappingURL=proving-service.js.map