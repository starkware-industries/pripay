/**
 * Type conversion utilities - thin wrappers around starknet.js encode/num modules.
 */
import { encode } from "starknet";
// ============ To BigInt ============
/** Convert Numeric to bigint */
export function toBigInt(value) {
    if (value instanceof Uint8Array) {
        return encode.uint8ArrayToBigInt(value);
    }
    return BigInt(value);
}
// ============ To Bytes ============
/** Convert Numeric to 32-byte Uint8Array (zero-padded) */
export function toBytes(value) {
    const n = toBigInt(value);
    const hex = n.toString(16).padStart(64, "0");
    return encode.hexStringToUint8Array(hex);
}
// ============ To Hex ============
/** Convert Numeric to hex string (with 0x prefix by default). Strings are treated as UTF-8. */
export function toHex(value, { prefix = true } = {}) {
    let hex;
    if (value instanceof Uint8Array) {
        hex = encode.buf2hex(value);
    }
    else if (typeof value === "bigint") {
        hex = value.toString(16);
    }
    else if (typeof value === "number") {
        hex = value.toString(16);
    }
    else if (typeof value === "string") {
        // Numeric strings (hex or decimal) are converted to numbers by toBigInt
        // Non-numeric strings would throw, so encode as UTF-8 for safety
        if (value.startsWith("0x") || value.startsWith("0X") || /^\d+$/.test(value)) {
            hex = toBigInt(value).toString(16);
        }
        else {
            hex = encode.buf2hex(encode.utf8ToArray(value));
        }
    }
    else {
        // Fallback for any other BigNumberish
        hex = toBigInt(value).toString(16);
    }
    return prefix ? `0x${hex}` : hex;
}
//# sourceMappingURL=convert.js.map