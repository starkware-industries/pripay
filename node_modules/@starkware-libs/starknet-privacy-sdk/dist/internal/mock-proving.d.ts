/**
 * Call-based proving provider for testing
 *
 * This provider simulates proof generation by making a call to the contract
 * to execute the invocation and capture the output.
 */
import type { BlockIdentifier, constants, ProviderInterface } from "starknet";
import type { Proof, ProofInvocation, ProofProviderInterface } from "../interfaces.js";
/**
 * A proving provider that uses Starknet calls to simulate proof generation.
 * This is useful for testing where we want to execute the contract logic
 * without actually generating zero-knowledge proofs.
 */
export declare class CallMockProofProvider implements ProofProviderInterface {
    protected readonly provider: ProviderInterface;
    protected readonly chainId: constants.StarknetChainId;
    private readonly options?;
    constructor(provider: ProviderInterface, chainId: constants.StarknetChainId, options?: {
        validateSignature?: boolean;
    } | undefined);
    getDefaultDetails(): Promise<import("../interfaces.js").ProofInvocationFactoryDetails>;
    prove(invocation: ProofInvocation, blockIdentifier?: BlockIdentifier): Promise<Proof>;
    /**
     * Validates the signature by calling is_valid_signature on the user's account.
     * This mirrors what the contract's __execute__ does after compile_actions.
     */
    private validateSignature;
}
//# sourceMappingURL=mock-proving.d.ts.map