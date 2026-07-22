import { BigNumberish } from "starknet";
export type Hash = bigint;
export type ChannelKey = bigint;
export type PublicKey = BigNumberish;
export type PrivateKey = BigNumberish;
/**
 * Convert a short string (up to 31 chars) to a felt, matching Cairo's short string literals.
 * e.g., 'channel_key:v1' in Cairo becomes the same bigint.
 */
export declare function shortStringToFelt(str: string): bigint;
/**
 * Poseidon hash of multiple felts.
 * String arguments are converted as follows:
 * - Numeric strings (hex "0x..." or decimal) are converted via toBigInt
 * - Short ASCII strings (domain tags like "channel_key:v1") are converted as Cairo short strings
 *
 * Note: This matches Cairo's hash function which does:
 *   PoseidonTrait::new().update_with(poseidon_hash_span(data)).finalize()
 * This is effectively h(h(data)) - a double hash.
 */
export declare function hash(...values: (BigNumberish | string)[]): Hash;
/**
 * Derive public key from private key (returns x-coordinate).
 */
export declare function derivePublicKey(privateKey: PrivateKey): bigint;
/** Generate a random bigint for use in encryption */
export declare function generateRandom(): bigint;
/** Generate a 120-bit random value for note encryption */
export declare function generateRandom120(): bigint;
export type SymmetricEncryption = {
    r: bigint;
    enc: bigint;
};
export declare function encryptSymmetric(shared: bigint, data: BigNumberish, r: bigint): SymmetricEncryption;
export declare function decryptSymmetric(encryption: SymmetricEncryption, shared: bigint): bigint;
export { toBigInt } from "./convert.js";
//# sourceMappingURL=crypto.d.ts.map