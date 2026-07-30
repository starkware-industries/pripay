/**
 * Proof provider that calls a remote proving service (JSON-RPC starknet_proveTransaction).
 */
import { RpcProvider } from "starknet";
import { toHex } from "../utils/convert.js";
import { getDefaultProofDetails } from "./proof-invocation-factory.js";
import { OhttpClient } from "./ohttp-client.js";
import { DEFAULT_REQUEST_TIMEOUT_MS, ProvingService, } from "./proving-service.js";
/**
 * Proof provider that sends the invocation to a remote proving service (JSON-RPC)
 * and returns the STARK proof. Server actions for execute_actions come from the
 * L2-to-L1 message payload (from_address = pool).
 *
 * @param provingServiceUrl - Full base URL of the proving service (e.g. https://prover.example.com:3000)
 */
export class ProvingServiceProofProvider {
    chainId;
    provingService;
    blockIdentifier;
    rpcProvider;
    poolAddressHex;
    cachedNonce = null;
    constructor(provingServiceUrl, chainId, options = {}) {
        this.chainId = chainId;
        let ohttpClient;
        if (options.ohttp) {
            const ohttpOptions = typeof options.ohttp === "object"
                ? { relayUrl: options.ohttp.relayUrl, publicKeyConfig: options.ohttp.publicKeyConfig }
                : undefined;
            ohttpClient = new OhttpClient(provingServiceUrl, ohttpOptions);
        }
        this.provingService = new ProvingService({
            baseUrl: provingServiceUrl,
            requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
            ohttpClient,
            retry: options.retry,
        });
        this.blockIdentifier = options.blockIdentifier ?? "latest";
        if (options.nodeUrl != null) {
            if (options.poolAddress == null) {
                throw new Error("ProvingServiceProofProvider: nodeUrl requires poolAddress to be set");
            }
            this.rpcProvider = new RpcProvider({ nodeUrl: options.nodeUrl });
            this.poolAddressHex = toHex(options.poolAddress);
        }
        else {
            this.rpcProvider = null;
            this.poolAddressHex = null;
        }
    }
    invalidateNonceCache() {
        this.cachedNonce = null;
    }
    async getDefaultDetails() {
        const base = getDefaultProofDetails(this.chainId);
        if (this.rpcProvider == null || this.poolAddressHex == null) {
            return base;
        }
        if (this.cachedNonce == null) {
            this.cachedNonce = BigInt(await this.rpcProvider.getNonceForAddress(this.poolAddressHex, "latest"));
        }
        return { ...base, nonce: this.cachedNonce };
    }
    async prove(invocation, blockIdentifier) {
        const blockId = blockIdentifier ?? this.blockIdentifier;
        const result = await this.provingService.proveTransaction(blockId, invocation);
        // L2-to-L1 message payload from the pool: [class_hash, ...serialized_actions].
        // The consumer strips the class_hash prefix before calling apply_actions.
        // TODO: Generalize this to support other projects.
        const poolAddressHex = toHex(invocation.sender_address);
        const poolMessage = result.l2_to_l1_messages?.find((m) => m.from_address?.toLowerCase() === poolAddressHex.toLowerCase());
        const output = poolMessage?.payload ?? [];
        const proofFacts = result.proof_facts ?? [];
        return {
            data: result.proof,
            output,
            proofFacts,
            additionalData: result.additional_data,
        };
    }
}
//# sourceMappingURL=proving-service-provider.js.map