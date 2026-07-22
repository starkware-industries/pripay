import { ProvingServiceError } from "./proving-service.js";
/** Error thrown when a block reorg is detected (HTTP 409 status). */
export declare class ReorgError extends Error {
    constructor(message: string);
}
/**
 * The deposit's source address is on the sanctions list. Terminal — retrying
 * with the same address will not succeed.
 */
export declare class ScreeningRejected extends Error {
    readonly name = "ScreeningRejected";
    constructor(reason?: string);
}
/**
 * Screening could not be completed (FPI cloud function or upstream unreachable).
 * Transient — the caller may retry later. Deposits fail closed: no signature
 * means no deposit.
 */
export declare class ScreeningUnavailable extends Error {
    readonly name = "ScreeningUnavailable";
    constructor(reason?: string);
}
/**
 * Map a {@link ProvingServiceError} to a typed screening error, or `undefined`
 * if it is not a screening verdict so the caller can rethrow the original.
 *
 * Code 10000 ("Transaction rejected") is overloaded — the interceptor also
 * emits it for non-pool blocks and for unexpected interceptor exceptions
 * (whose `data` is the raw error message). We therefore switch on the *exact*
 * opaque reasons above rather than treating every 10000 as terminal: a
 * transient interceptor fault must not be reported as a permanent sanctions
 * rejection the user is told never to retry.
 */
export declare function screeningErrorFromProvingError(error: ProvingServiceError): ScreeningRejected | ScreeningUnavailable | undefined;
//# sourceMappingURL=errors.d.ts.map