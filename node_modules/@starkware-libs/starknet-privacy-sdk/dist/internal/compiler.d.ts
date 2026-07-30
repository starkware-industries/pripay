/**
 * ActionCompiler - Resolves contexts and prepares actions for execution.
 *
 * Context resolution order:
 * 1. Registry (provided via options)
 * 2. OpenChannelActions in the same batch (compute channel with nonce=0)
 * 3. AutoSetup (implicitly create OpenChannelAction)
 * 4. Discovery (call discovery service)
 *
 * After compilation:
 * - Registry is updated with resolved channels and notes
 * - Actions may have UseNoteActions added (if autoSelectNotes)
 * - ClientAction[] is produced with all context "unwrapped"
 *
 * Note: After pool execution, use applyOptimisticUpdate() from registry-updater.ts
 * to update the registry with the results.
 */
import type { Actions, DiscoveryProviderInterface, ExecuteOptions, PrivateRegistry, StarknetAddressBigint, ViewingKey, Warning } from "../interfaces.js";
import type { ClientAction } from "./client-actions.js";
export type CompileResult = {
    clientActions: ClientAction[];
    registry: PrivateRegistry;
    warnings: Warning[];
};
export declare class ActionCompiler {
    private userAddress;
    private userViewingKey;
    private discoveryProvider;
    private poolAddress;
    constructor(userAddress: bigint, userViewingKey: ViewingKey, discoveryProvider: DiscoveryProviderInterface, poolAddress?: StarknetAddressBigint);
    /**
     * Compile actions by resolving contexts, updating the registry, and producing ClientAction[].
     */
    compile(actions: Actions, options?: ExecuteOptions): Promise<CompileResult>;
    private compileOnce;
    private checkWarnings;
    private getRecipientsNeeded;
    private createPool;
    /**
     * Transform high-level Actions to low-level ClientAction[] using registry context.
     */
    private transformToClientActions;
    /**
     * Resolve recipient channels by discovering or using registry.
     */
    private resolveRecipientChannels;
    /**
     * Resolve notes by discovering and/or auto-selecting from registry.
     */
    private resolveNotes;
    private cloneRegistry;
    private allOpen;
}
//# sourceMappingURL=compiler.d.ts.map