import { ec } from "starknet";
import { AddressMap } from "./utils/index.js";
/**
 * Maximum valid viewing key value (half the STARK curve order).
 * Private keys must be in range [1, MAX_VIEWING_KEY].
 */
export const MAX_VIEWING_KEY = ec.starkCurve.CURVE.n / 2n;
/** Marker for creating an open note (a note whose amount is open and can be deposited into later) */
export const Open = Symbol("Open");
export const All = Symbol("All");
/**
 * Result of setupRequirement - indicates what setup is needed before a transfer.
 * Values are ordered by priority (higher value = more setup needed).
 */
export var SetupRequirement;
(function (SetupRequirement) {
    /** Recipient is not registered */
    SetupRequirement[SetupRequirement["Register"] = 0] = "Register";
    /** Need to setup initial channel*/
    SetupRequirement[SetupRequirement["SetupChannel"] = 1] = "SetupChannel";
    /** Need to setup the token subchannel */
    SetupRequirement[SetupRequirement["SetupToken"] = 2] = "SetupToken";
    /** Ready to transfer - no setup needed */
    SetupRequirement[SetupRequirement["Ready"] = 3] = "Ready";
})(SetupRequirement || (SetupRequirement = {}));
// Import and re-export from internal channel
import { Witness, Channel } from "./internal/channel.js";
export { Witness, Channel };
/** Create an empty private registry */
export function createEmptyRegistry() {
    return {
        channels: new AddressMap(),
        notes: new AddressMap(() => []),
    };
}
export var WarningCode;
(function (WarningCode) {
    WarningCode["USER_LINKAGE"] = "USER_LINKAGE";
})(WarningCode || (WarningCode = {}));
//# sourceMappingURL=interfaces.js.map