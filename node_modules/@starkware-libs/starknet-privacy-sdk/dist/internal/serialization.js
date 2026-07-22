/**
 * Serialization utilities for converting ClientActions to Cairo calldata format.
 */
import { CairoCustomEnum } from "starknet";
import { CLIENT_ACTION_TYPES } from "./client-actions.js";
/**
 * Convert a ClientAction to a CairoCustomEnum for serialization.
 * Since ClientAction types now match the Cairo ABI exactly (snake_case),
 * no field name conversion is needed.
 */
function toCairoEnum(action) {
    const variants = {};
    for (const variant of CLIENT_ACTION_TYPES) {
        variants[variant] = variant === action.type ? action.input : undefined;
    }
    return new CairoCustomEnum(variants);
}
/**
 * Convert an array of ClientActions to CairoCustomEnums for Cairo calldata serialization.
 * Serializes all client actions to Cairo calldata.
 */
export function serializeClientActions(actions) {
    return actions.map(toCairoEnum);
}
//# sourceMappingURL=serialization.js.map