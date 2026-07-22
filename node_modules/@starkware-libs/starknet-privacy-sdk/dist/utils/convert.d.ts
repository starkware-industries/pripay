/**
 * Type conversion utilities - thin wrappers around starknet.js encode/num modules.
 */
import { BigNumberish } from "starknet";
/** Any value that can be converted to bigint, bytes, or hex */
export type Numeric = BigNumberish | Uint8Array;
/** Convert Numeric to bigint */
export declare function toBigInt(value: Numeric): bigint;
/** Convert Numeric to 32-byte Uint8Array (zero-padded) */
export declare function toBytes(value: Numeric): Uint8Array;
/** Convert Numeric to hex string (with 0x prefix by default). Strings are treated as UTF-8. */
export declare function toHex(value: Numeric, { prefix }?: {
    prefix?: boolean;
}): string;
//# sourceMappingURL=convert.d.ts.map