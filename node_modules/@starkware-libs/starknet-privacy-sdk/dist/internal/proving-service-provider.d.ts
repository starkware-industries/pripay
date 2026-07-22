/**
 * Proof provider that calls a remote proving service (JSON-RPC starknet_proveTransaction).
 */
import type { constants } from "starknet";
import type { Proof, ProofInvocationFactoryDetails, ProvingBlockId, ProofInvocation, ProofProviderInterface, StarknetAddress } from "../interfaces.js";
import { type OhttpOption } from "./ohttp-client.js";
import { type ProvingRetryOptions } from "./proving-service.js";
/** Options for ProvingServiceProofProvider. */
export type ProvingServiceProofProviderOptions = {
    /** Request timeout in ms. */
    requestTimeoutMs?: number;
    /**
     * Default block identifier for proving. Sent as block_id: "latest" | { block_number } | { block_hash }.
     * Used when `blockIdentifier` is not provided in `prove()`.
     * Default `"latest"`.
     */
    blockIdentifier?: ProvingBlockId;
    /**
     * Optional RPC node URL used to fetch the pool nonce (cached; use invalidateNonceCache() after
     * nonce errors). Requires `poolAddress` to be set. When both are provided, getDefaultDetails()
     * returns details with the fetched nonce; no provider on account or factory needed.
     */
    nodeUrl?: string;
    /**
     * Pool contract address used for nonce fetching. Required when `nodeUrl` is set.
     */
    poolAddress?: StarknetAddress;
    /** Enable OHTTP envelope encryption. Pass `true` for defaults, or an object for custom relay/key config. */
    ohttp?: OhttpOption;
    /**
     * Retry policy for transient (service-busy `-32005` / HTTP 503) prove failures.
     * Pass `{ maxRetries: 0 }` to disable.
     */
    retry?: ProvingRetryOptions;
};
/**
 * Proof provider that sends the invocation to a remote proving service (JSON-RPC)
 * and returns the STARK proof. Server actions for execute_actions come from the
 * L2-to-L1 message payload (from_address = pool).
 *
 * @param provingServiceUrl - Full base URL of the proving service (e.g. https://prover.example.com:3000)
 */
export declare class ProvingServiceProofProvider implements ProofProviderInterface {
    private readonly chainId;
    private readonly provingService;
    private readonly blockIdentifier;
    private readonly rpcProvider;
    private readonly poolAddressHex;
    private cachedNonce;
    constructor(provingServiceUrl: string, chainId: constants.StarknetChainId, options?: ProvingServiceProofProviderOptions);
    invalidateNonceCache(): void;
    getDefaultDetails(): Promise<ProofInvocationFactoryDetails>;
    prove(invocation: ProofInvocation, blockIdentifier?: ProvingBlockId): Promise<Proof>;
}
//# sourceMappingURL=proving-service-provider.d.ts.map