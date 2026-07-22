/**
 * Packing of the screening attestation into `apply_actions` calldata.
 *
 * The attestation travels as a Serde-encoded `Option<ScreeningAttestation>`
 * appended after the action span: `[0x1]` when absent, `[0x0, issued_at,
 * sig_r, sig_s]` when present. It is a separately-deserialized parameter, not
 * part of the proof-committed action span, so it can be swapped (e.g. a
 * timestamp refresh) without re-proving.
 */
import type { AdditionalData } from "./proving-service.js";
/**
 * Serde-encode the attestation from a prove response's `additional_data` as
 * the trailing calldata felts, hex-encoded to match the prover-produced
 * action felts they follow.
 */
export declare function screeningCalldataSuffix(additionalData?: AdditionalData): string[];
//# sourceMappingURL=screening-calldata.d.ts.map