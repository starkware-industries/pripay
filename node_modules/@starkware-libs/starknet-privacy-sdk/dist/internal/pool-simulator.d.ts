/**
 * PoolSimulator - Minimal state tracker for the compiler.
 *
 * This class tracks channel and note state without encryption, hashing, or balance validation.
 * It's used by the ActionCompiler to simulate action execution and track nonces.
 *
 * Key differences from PrivacyPool:
 * - No encrypted state (publicKeys, channels, subchannels, notes, nullifiers, outgoingChannels)
 * - No encryption utilities
 * - No balance validation
 * - No callbacks - state is updated directly
 * - Just tracks Channel objects with nonces and Note objects
 */
import type { Note, PrivateRegistry, StarknetAddressBigint } from "../interfaces.js";
import { Channel } from "./channel.js";
import type { ClientAction } from "./client-actions.js";
export declare class PoolSimulator {
    private readonly userAddress;
    private readonly userViewingKey;
    private nextChannelIndex;
    private channels;
    private notes;
    constructor(userAddress: StarknetAddressBigint, userViewingKey: bigint, nextChannelIndex: number);
    /**
     * Execute a client action, updating the tracked state.
     * No encryption, no hashing, no balance checks.
     */
    execute(action: ClientAction): void;
    /**
     * Get the channel to a recipient.
     */
    getChannel(recipient: StarknetAddressBigint): Channel | undefined;
    getNextChannelIndex(): number;
    /**
     * Check if a note exists by ID.
     */
    hasNote(token: StarknetAddressBigint, noteId: bigint): boolean;
    /**
     * Setup a channel from registry/discovery.
     * Used to initialize state before compilation.
     */
    setupChannel(recipientAddress: StarknetAddressBigint, channel: Channel): void;
    /**
     * Setup a note from registry.
     * Used to initialize state before compilation.
     */
    setupNote(token: StarknetAddressBigint, note: Note): void;
    /**
     * Export tracked state back to the registry.
     */
    updateRegistry(registry: PrivateRegistry): PrivateRegistry;
    private handleSetViewingKey;
    private handleOpenChannel;
    private handleOpenSubchannel;
    private handleUseNote;
    private handleCreateEncNote;
    private handleCreateOpenNote;
}
//# sourceMappingURL=pool-simulator.d.ts.map