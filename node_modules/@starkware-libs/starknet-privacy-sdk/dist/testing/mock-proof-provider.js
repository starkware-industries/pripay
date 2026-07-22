/**
 * MockProofProvider - Proof provider for mock testing.
 *
 * Uses MockPoolContract to execute client actions and returns the
 * MockServerAction[] callbacks as the proof output.
 */
import { getDefaultProofDetails } from "../internal/proof-invocation-factory.js";
import { ProvingServiceError } from "../internal/proving-service.js";
import { bigintReviver } from "./mock-proof-invocation-factory.js";
import { constants } from "starknet";
import { buildMessagePayload } from "../utils/proof-facts.js";
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
export class MockProofProvider {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    async getDefaultDetails() {
        return getDefaultProofDetails(constants.StarknetChainId.SN_SEPOLIA);
    }
    async prove(invocation) {
        const calldata = invocation.calldata;
        const userAddress = BigInt(calldata[0]);
        const privateKey = BigInt(calldata[1]);
        const clientActions = JSON.parse(calldata[2], bigintReviver);
        // Execute on mock pool - returns MockServerAction[] (serialized as string[])
        let callbacks;
        try {
            callbacks = this.pool.execute(userAddress, privateKey, ...clientActions);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new ProvingServiceError(-32603, "Internal error", message);
        }
        return {
            data: "",
            // L2-to-L1 message payload: [class_hash, ...callbacks], as in a real
            // prove response.
            output: buildMessagePayload(this.pool.classHash, callbacks),
            proofFacts: [],
        };
    }
}
//# sourceMappingURL=mock-proof-provider.js.map