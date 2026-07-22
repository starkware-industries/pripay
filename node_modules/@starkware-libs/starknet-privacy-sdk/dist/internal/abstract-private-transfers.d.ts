/**
 * Abstract base class for PrivateTransfers implementations
 *
 * Provides default implementations for discovery methods and builder creation,
 * leaving only the execute method as abstract for subclasses to implement.
 */
import type { BlockIdentifier } from "starknet";
import type { Actions, Channel, DiscoveryProviderInterface, ExecuteOptions, ExecuteResult, Note, PrivateTransfersBuilder, PrivateTransfersInterface, ProofInvocationResult, ProvingBlockId, SimulateOptions, StarknetAddress, StarknetAddressBigint, ViewingKey, ViewingKeyProvider } from "../interfaces.js";
import { SetupRequirement } from "../interfaces.js";
import { AddressMap } from "../utils/maps.js";
import type { ChannelCursor, NotesCursor, RecipientsFilter } from "./channel.js";
/**
 * Abstract base class that implements the common functionality for PrivateTransfers.
 * Subclasses only need to implement the execute method.
 */
export declare abstract class AbstractPrivateTransfers implements PrivateTransfersInterface {
    protected readonly viewingKeyProvider: ViewingKeyProvider;
    protected readonly discoveryProvider: DiscoveryProviderInterface;
    readonly user: StarknetAddressBigint;
    /** No-op in base; override in subclass when using a provider that caches nonce. */
    invalidateProofNonceCache(): void;
    constructor(userAddress: StarknetAddress, viewingKeyProvider: ViewingKeyProvider, discoveryProvider: DiscoveryProviderInterface);
    /**
     * Get the current viewing key from the provider
     */
    protected getViewingKey(): Promise<ViewingKey>;
    /**
     * Discover unspent notes per token
     */
    discoverNotes(params?: {
        since?: BlockIdentifier;
        cursor?: NotesCursor;
    }): Promise<{
        timestamp: BlockIdentifier;
        notes: AddressMap<Note[]>;
    }>;
    /**
     * Discover channels for one or more recipients
     */
    discoverChannels(recipients: RecipientsFilter<StarknetAddress>, params?: {
        cursor?: ChannelCursor;
    }): Promise<{
        timestamp: BlockIdentifier;
        channels?: AddressMap<Channel>;
        total?: number;
    }>;
    /**
     * Check the setup requirements for a recipient and token
     */
    discoverRequirement(recipient: StarknetAddress, token: StarknetAddress): Promise<SetupRequirement>;
    /**
     * Create a builder for batching multiple operations
     */
    build(options?: ExecuteOptions): PrivateTransfersBuilder;
    /**
     * Execute raw actions: compile, prove, and return the call+proof.
     */
    execute(actions: Actions, options?: ExecuteOptions): Promise<ExecuteResult>;
    simulate(_actions: Actions, _options: ExecuteOptions & SimulateOptions): Promise<ExecuteResult>;
    /**
     * Build a proof transaction for the raw actions - must be implemented by subclasses
     */
    abstract createProofInvocation(actions: Actions, options?: Omit<ExecuteOptions, "provingBlockId">): Promise<ProofInvocationResult>;
    /**
     * Execute a pre-built proof invocation: prove it and return the call+proof ready for submission.
     */
    abstract executeWithInvocation(invocation: ProofInvocationResult, provingBlockId?: ProvingBlockId): Promise<ExecuteResult>;
}
//# sourceMappingURL=abstract-private-transfers.d.ts.map