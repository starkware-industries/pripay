/**
 * Test-only signer for screening attestations.
 *
 * Produces the STARK-curve ECDSA signature over the SNIP-12 (revision 1)
 * typed-data message the privacy-pool contract verifies on-chain
 * (packages/privacy/src/snip12.cairo) for a regular-pool deposit. In production
 * this signature comes from the off-chain screener (the proving service relays
 * it); tests fabricate it here so the devnet suite can exercise the screening
 * path without a live screener.
 *
 * The message hash and signature stay byte-compatible with the canonical
 * cross-language vectors in fixtures/screening-vectors.json — screening-signer
 * test asserts this signer reproduces every committed vector.
 *
 * SNIP-12 revision-1 message hash:
 *   poseidon_hash_span([
 *     shortstring("StarkNet Message"),
 *     domain_hash,           // poseidon(DOMAIN_TYPE_HASH, name, version, chain_id, 1)
 *     signer_public_key,     // SNIP-12 "account" slot
 *     message_struct_hash,   // poseidon(DEPOSITOR_VALIDATION_TYPE_HASH, depositor, issued_at)
 *   ])
 */
import type { ScreeningSignature } from "../internal/proving-service.js";
export declare const SCREENING_SIGNER_PRIVATE_KEY = "0xCAFEBABE";
export declare const SCREENING_SIGNER_PUBLIC_KEY: bigint;
/**
 * Recompute the SNIP-12 message hash the contract verifies. `chainId` and
 * `depositor` are field elements; `signerPublicKey` fills the SNIP-12 account
 * slot and is the key `check_ecdsa_signature` verifies against.
 */
export declare function computeScreeningMessageHash(chainId: bigint, depositor: bigint, issuedAt: bigint, signerPublicKey: bigint): bigint;
/**
 * Sign a screening attestation. `issuedAt` is unix seconds. The signer's public
 * key (derived from `privateKey`) fills the SNIP-12 account slot, so the
 * signature is bound to the exact key that verifies it on-chain.
 */
export declare function signScreeningAttestation(privateKey: string, chainId: bigint, depositor: bigint, issuedAt: number): ScreeningSignature;
//# sourceMappingURL=screening-signer.d.ts.map