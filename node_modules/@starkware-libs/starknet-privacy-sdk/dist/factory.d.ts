/**
 * Factory functions for creating SDK instances.
 */
import type { PrivateTransfersInterface, ViewingKeyProvider, ProofProviderInterface, ProofProviderConfig, DiscoveryProviderInterface, DiscoveryProviderConfig, StarknetAddress, PrivateTransfersUser } from "./interfaces.js";
import type { PoolCapabilityMode } from "./internal/pool-mode.js";
import { type ProofInvocationFactoryInterface } from "./internal/proof-invocation-factory.js";
export interface CreatePrivateTransfersParams {
    /**
     * Identity used to sign proof invocations. Only `address` and `signer` are
     * read, so a full starknet.js `Account` is structurally assignable here as
     * well as a minimal `{ address, signer }` object. For smart wallets where
     * account-level signature wrapping (e.g. owner + guardian merge) lives
     * outside the signer, supply a custom `signer` implementation rather than
     * passing the full `Account`.
     */
    account: PrivateTransfersUser;
    viewingKeyProvider: ViewingKeyProvider;
    proofInvocationFactory?: ProofInvocationFactoryInterface;
    provingProvider: ProofProviderInterface | ProofProviderConfig;
    discoveryProvider: DiscoveryProviderInterface | DiscoveryProviderConfig;
    poolContractAddress: StarknetAddress;
    /**
     * Overrides class-hash pool-mode detection — for pools whose class hash
     * isn't pinned in the SDK (e.g. source-built devnet/test pools).
     */
    poolMode?: PoolCapabilityMode;
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
export declare function createPrivateTransfers(params: CreatePrivateTransfersParams): PrivateTransfersInterface;
//# sourceMappingURL=factory.d.ts.map