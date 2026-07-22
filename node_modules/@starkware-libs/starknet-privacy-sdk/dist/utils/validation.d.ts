import type { Amount, PrivateRecipient, StarknetAddress, ViewingKey } from "../interfaces.js";
import { All, Open } from "../interfaces.js";
/**
 * Asserts a condition is truthy, throwing an error with the given message if not.
 * Browser-compatible alternative to Node's assert.
 * @param condition - The condition to check
 * @param message - Function returning the error message if condition is falsy (lazy evaluation).
 * @throws Error if condition is falsy
 */
export declare function assert(condition: unknown, message: () => string): asserts condition;
/**
 * Asserts that a viewing key is valid (in range [1, MAX_VIEWING_KEY]).
 * @throws Error if the viewing key is out of range
 */
export declare function assertViewingKey(viewingKey: ViewingKey): void;
/**
 * Asserts that a recipient is valid (not undefined or null) and extracts the address.
 * @returns The StarknetAddress from the recipient
 * @throws Error if the recipient is undefined or null
 */
export declare function assertRecipientAddress(recipient: StarknetAddress | PrivateRecipient): StarknetAddress;
/**
 * Type guard to check if a value is an Open marker (for open notes).
 * @param value - The value to check (Amount or Open)
 * @returns true if the value is an Open marker, false if it's an Amount
 */
export declare function isOpen(value: Amount | Open): value is Open;
/**
 * Type guard to check if a value is an Open note action.
 * @param obj - The object to check
 * @returns true if the object is an Open note action, false if it's an Amount note action
 */
export declare function isOpenNote<T extends {
    amount: Amount | Open;
}>(obj: T): obj is T & {
    amount: Open;
};
/**
 * Type guard to check if a value is an All marker (for all notes).
 * @param value - The value to check (Amount or All)
 * @returns true if the value is an All marker, false if it's an Amount
 */
export declare function isAll(value: Amount | All): value is All;
//# sourceMappingURL=validation.d.ts.map