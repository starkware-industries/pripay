/**
 * Shared helpers for testing utilities.
 */
// ============ Mock Helpers ============
export function createMockProof(overrides) {
    return {
        data: "",
        output: ["0x0"],
        proofFacts: [],
        ...overrides,
    };
}
export function createMockCallAndProof(actions) {
    return {
        call: {
            contractAddress: "0x0",
            entrypoint: "execute_writes",
            calldata: actions,
        }, // eslint-disable-line @typescript-eslint/no-explicit-any
        proof: createMockProof(),
    };
}
// Symbol used as a type marker for withdrawal operations (vs NoteNonce for transfers)
export const Withdrawal = Symbol("Withdrawal");
//# sourceMappingURL=helpers.js.map