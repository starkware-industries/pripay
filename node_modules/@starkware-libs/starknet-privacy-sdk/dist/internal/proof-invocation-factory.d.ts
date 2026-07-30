/**
 * ProofInvocationFactory - Creates invocation data for proving.
 *
 * Abstracts how client actions are transformed into data for the proof provider.
 * - Starknet implementation: serializes to Cairo calldata and builds an invocation
 * - Mock implementation: passes through client actions directly
 */
import type { BigNumberish, CallResult, SignerInterface } from "starknet";
import type { constants } from "starknet";
import type { ProofInvocation, ProofInvocationFactoryDetails, StarknetAddress } from "../interfaces.js";
import { ClientAction } from "./client-actions.js";
/**
 * Build default proof invocation factory details for a given chain.
 * Plain helper so providers only need to pass their chainId.
 */
export declare function getDefaultProofDetails(chainId: constants.StarknetChainId): ProofInvocationFactoryDetails;
/**
 * Minimal user info needed for creating a proof invocation.
 */
export interface ProofUser {
    address: BigNumberish;
    signer: SignerInterface;
    viewingKey: BigNumberish;
}
/**
 * Factory interface for creating proof invocation data.
 */
export interface ProofInvocationFactoryInterface {
    create(user: ProofUser, poolAddress: StarknetAddress, clientActions: ClientAction[], details: ProofInvocationFactoryDetails): Promise<ProofInvocation>;
    /**
     * Parse proof output for logging/debugging.
     * Returns the decoded server actions.
     */
    parseOutput(output: string[]): CallResult;
}
/**
 * Build __execute__ calldata wrapping a single Call to compile_actions.
 * Layout: [array_len=1, to, selector, inner_calldata_len, ...inner_calldata]
 */
export declare function compileExecuteCalldata(poolAddress: string, executeViewCalldata: string[]): string[];
/**
 * Extract inner compile_actions calldata from __execute__'s Array<Call> calldata.
 * Layout: [array_len=1, to, selector, inner_calldata_len, ...inner_calldata]
 */
export declare function extractExecuteViewCalldata(executeCalldata: string[]): string[];
/**
 * Starknet implementation - serializes client actions to an invocation with signature.
 */
export declare class ProofInvocationFactory implements ProofInvocationFactoryInterface {
    create(user: ProofUser, poolAddress: StarknetAddress, clientActions: ClientAction[], details: ProofInvocationFactoryDetails): Promise<ProofInvocation>;
    parseOutput(output: string[]): CallResult;
}
//# sourceMappingURL=proof-invocation-factory.d.ts.map