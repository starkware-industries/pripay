/**
 * MockProofProvider - Proof provider for mock testing.
 *
 * Uses MockPoolContract to execute client actions and returns the
 * MockServerAction[] callbacks as the proof output.
 */
import type { Proof, ProofInvocation, ProofProviderInterface } from "../interfaces.js";
import type { MockPoolContract } from "./mock-pool-contract.js";
/**
 * Mock proof provider that executes actions on MockPoolContract.
 *
 * The invocation data is expected to be ProofInvocation with calldata
 * containing [userAddress, JSON.stringify(clientActions)].
 * The provider:
 * 1. Parses the invocation to get user address and client actions
 * 2. Executes the actions (getting callbacks)
 * 3. Returns callbacks in proof.output
 */
export declare class MockProofProvider implements ProofProviderInterface {
    private pool;
    constructor(pool: MockPoolContract);
    getDefaultDetails(): Promise<import("../interfaces.js").ProofInvocationFactoryDetails>;
    prove(invocation: ProofInvocation): Promise<Proof>;
}
//# sourceMappingURL=mock-proof-provider.d.ts.map