/**
 * Starknet error decoding utilities.
 * Converts hex error messages and function selectors to human-readable strings.
 */
/**
 * Add additional function names to the selector lookup map.
 * Useful for extending with ABI-specific functions.
 */
export declare function addSelectors(names: string[]): void;
/**
 * Decoded error information
 */
export interface DecodedError {
    /** Original error object/string */
    raw: unknown;
    /** Decoded with human-readable selectors and error messages */
    decoded: unknown;
}
/**
 * Look up a selector hex value to get the function name
 */
export declare function lookupSelector(selectorHex: string): string | undefined;
/**
 * Convert hex to ASCII string if it looks like printable text
 */
export declare function hexToString(hex: unknown): unknown;
/**
 * Decode an array of hex error values
 */
export declare function decodeErrorArray(arr: unknown[]): unknown[];
/**
 * Recursively decode error objects, arrays, and hex strings
 */
export declare function decodeValue(obj: unknown): unknown;
/**
 * Decode error from an RPC error or transaction trace
 */
export declare function decodeError(error: unknown): DecodedError;
//# sourceMappingURL=error-decoder.d.ts.map