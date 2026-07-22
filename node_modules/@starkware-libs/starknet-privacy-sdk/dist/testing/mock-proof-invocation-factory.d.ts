/**
 * Mock ProofInvocationFactory implementation for testing.
 *
 * Simply passes through the client actions without serialization.
 * The MockProofProvider will use these directly with MockPoolContract.
 */
import type { ClientAction } from "../internal/client-actions.js";
import type { ProofInvocationFactoryInterface, ProofUser } from "../internal/proof-invocation-factory.js";
import type { ProofInvocation, ProofInvocationFactoryDetails, StarknetAddress } from "../interfaces.js";
import type { CallResult } from "starknet";
/**
 * JSON reviver that converts prefixed strings back to BigInts and Symbols.
 */
export declare function bigintReviver(_key: string, value: unknown): unknown;
/**
 * Mock implementation - creates a minimal ProofInvocation for testing.
 * The calldata contains just the user address and client actions for the mock pool.
 */
export declare class MockProofInvocationFactory implements ProofInvocationFactoryInterface {
    create(user: ProofUser, poolAddress: StarknetAddress, clientActions: ClientAction[], details: ProofInvocationFactoryDetails): Promise<ProofInvocation>;
    parseOutput(output: string[]): CallResult;
}
//# sourceMappingURL=mock-proof-invocation-factory.d.ts.map