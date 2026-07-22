/**
 * Serialization utilities for converting ClientActions to Cairo calldata format.
 */
import { CairoCustomEnum } from "starknet";
import type { ClientAction } from "./client-actions.js";
/**
 * Convert an array of ClientActions to CairoCustomEnums for Cairo calldata serialization.
 * Serializes all client actions to Cairo calldata.
 */
export declare function serializeClientActions(actions: ClientAction[]): CairoCustomEnum[];
//# sourceMappingURL=serialization.d.ts.map