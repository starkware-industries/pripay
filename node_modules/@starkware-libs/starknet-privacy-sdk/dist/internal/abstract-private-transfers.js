/**
 * Abstract base class for PrivateTransfers implementations
 *
 * Provides default implementations for discovery methods and builder creation,
 * leaving only the execute method as abstract for subclasses to implement.
 */
import { toBigInt } from "../utils/crypto.js";
import { PrivateTransfersBuilderImpl } from "./builders.js";
/**
 * Abstract base class that implements the common functionality for PrivateTransfers.
 * Subclasses only need to implement the execute method.
 */
export class AbstractPrivateTransfers {
    viewingKeyProvider;
    discoveryProvider;
    user;
    /** No-op in base; override in subclass when using a provider that caches nonce. */
    invalidateProofNonceCache() { }
    constructor(userAddress, viewingKeyProvider, discoveryProvider) {
        this.viewingKeyProvider = viewingKeyProvider;
        this.discoveryProvider = discoveryProvider;
        this.user = toBigInt(userAddress);
    }
    /**
     * Get the current viewing key from the provider
     */
    async getViewingKey() {
        return await this.viewingKeyProvider.getViewingKey();
    }
    /**
     * Discover unspent notes per token
     */
    async discoverNotes(params = {}) {
        return this.discoveryProvider.discoverNotes(this.user, await this.getViewingKey(), params);
    }
    /**
     * Discover channels for one or more recipients
     */
    async discoverChannels(recipients, params) {
        return this.discoveryProvider.discoverChannels(this.user, await this.getViewingKey(), Array.isArray(recipients) ? recipients.map(toBigInt) : recipients, params);
    }
    /**
     * Check the setup requirements for a recipient and token
     */
    async discoverRequirement(recipient, token) {
        return this.discoveryProvider.discoverRequirement(this.user, await this.getViewingKey(), toBigInt(recipient), toBigInt(token));
    }
    /**
     * Create a builder for batching multiple operations
     */
    build(options) {
        return new PrivateTransfersBuilderImpl(this, this.user, options);
    }
    /**
     * Execute raw actions: compile, prove, and return the call+proof.
     */
    async execute(actions, options) {
        const invocationResult = await this.createProofInvocation(actions, options);
        return this.executeWithInvocation(invocationResult, options?.provingBlockId);
    }
    async simulate(_actions, _options) {
        throw new Error("simulate() is not supported by this implementation");
    }
}
//# sourceMappingURL=abstract-private-transfers.js.map