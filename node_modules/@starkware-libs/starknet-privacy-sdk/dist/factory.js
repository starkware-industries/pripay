/**
 * Factory functions for creating SDK instances.
 */
import { PrivateTransfers } from "./internal/private-transfers.js";
import { ProofInvocationFactory, } from "./internal/proof-invocation-factory.js";
import { ProvingServiceProofProvider } from "./internal/proving-service-provider.js";
import { IndexerDiscoveryProvider } from "./internal/indexer-discovery.js";
function isProofProviderConfig(x) {
    return typeof x === "object" && x !== null && "url" in x && "chainId" in x;
}
function isDiscoveryProviderConfig(x) {
    return typeof x === "object" && x !== null && "url" in x && !("discoverNotes" in x);
}
/**
 * Creates a new PrivateTransfers instance for interacting with the privacy pool.
 *
 * You can pass either **instances** (e.g. mocks or your own implementations) or **configs**
 * for the production proving and discovery providers. When you pass a config, the factory
 * creates the corresponding production implementation (ProvingServiceProofProvider /
 * IndexerDiscoveryProvider) for you.
 *
 * @param params - Configuration object containing account, providers (or configs), and pool address
 * @returns A PrivateTransfers instance
 *
 * @example With a full Account
 * ```typescript
 * const account = new Account(provider, address, privateKey);
 * const privateTransfers = createPrivateTransfers({
 *   account,
 *   viewingKeyProvider: { getViewingKey: async () => myPrivateKey },
 *   provingProvider: { url: "https://prover.example.com", chainId: constants.StarknetChainId.SN_MAIN },
 *   discoveryProvider: { url: "https://indexer.example.com" },
 *   poolContractAddress: poolAddress,
 * });
 * ```
 *
 * @example With a minimal `{ address, signer }` (e.g. smart wallets that wrap signing)
 * ```typescript
 * const privateTransfers = createPrivateTransfers({
 *   account: { address: myAddress, signer: customProofSigner },
 *   viewingKeyProvider: { getViewingKey: async () => myPrivateKey },
 *   provingProvider: new MockProofProvider(pool),
 *   discoveryProvider: new ContractDiscoveryProvider(pool),
 *   poolContractAddress: poolAddress,
 * });
 * ```
 */
export function createPrivateTransfers(params) {
    const provingProvider = isProofProviderConfig(params.provingProvider)
        ? new ProvingServiceProofProvider(params.provingProvider.url, params.provingProvider.chainId, {
            requestTimeoutMs: params.provingProvider.requestTimeoutMs,
            blockIdentifier: params.provingProvider.blockIdentifier,
            nodeUrl: params.provingProvider.nodeUrl,
            poolAddress: params.poolContractAddress,
            ohttp: params.provingProvider.ohttp,
            retry: params.provingProvider.retry,
        })
        : params.provingProvider;
    const discoveryProvider = isDiscoveryProviderConfig(params.discoveryProvider)
        ? new IndexerDiscoveryProvider(params.discoveryProvider.url, params.poolContractAddress)
        : params.discoveryProvider;
    return new PrivateTransfers({
        account: params.account,
        viewingKeyProvider: params.viewingKeyProvider,
        provingProvider,
        discoveryProvider,
        proofInvocationFactory: params.proofInvocationFactory ?? new ProofInvocationFactory(),
        poolContractAddress: params.poolContractAddress,
        poolMode: params.poolMode,
    });
}
//# sourceMappingURL=factory.js.map