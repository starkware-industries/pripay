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
import { Channel } from "./channel.js";
import { derivePublicKey, toBigInt } from "../utils/crypto.js";
import { AddressMap } from "../utils/maps.js";
import { compute_channel_key, compute_note_id } from "../utils/hashes.js";
import { debugLog } from "../utils/logging.js";
import { toHex } from "../utils/convert.js";
import { assert } from "../utils/validation.js";
export class PoolSimulator {
    userAddress;
    userViewingKey;
    nextChannelIndex;
    // Per-user state: channels from this user to recipients, notes owned by this user
    channels = new AddressMap();
    notes = new AddressMap(() => new Map());
    constructor(userAddress, userViewingKey, nextChannelIndex) {
        this.userAddress = userAddress;
        this.userViewingKey = userViewingKey;
        this.nextChannelIndex = nextChannelIndex;
    }
    /**
     * Execute a client action, updating the tracked state.
     * No encryption, no hashing, no balance checks.
     */
    execute(action) {
        switch (action.type) {
            case "SetViewingKey":
                this.handleSetViewingKey(action.input);
                break;
            case "OpenChannel":
                this.handleOpenChannel(action.input);
                break;
            case "OpenSubchannel":
                this.handleOpenSubchannel(action.input);
                break;
            case "Deposit":
                // Deposits don't affect tracking state (handled by MockPoolContract)
                break;
            case "UseNote":
                this.handleUseNote(action.input);
                break;
            case "CreateEncNote":
                this.handleCreateEncNote(action.input);
                break;
            case "CreateOpenNote":
                this.handleCreateOpenNote(action.input);
                break;
            case "Withdraw":
                // Withdrawals don't affect tracking state (handled by MockPoolContract)
                break;
            case "InvokeExternal":
                // InvokeExternal doesn't affect tracking state
                break;
        }
    }
    /**
     * Get the channel to a recipient.
     */
    getChannel(recipient) {
        return this.channels.get(recipient);
    }
    getNextChannelIndex() {
        return this.nextChannelIndex;
    }
    /**
     * Check if a note exists by ID.
     */
    hasNote(token, noteId) {
        return this.notes.get(token)?.has(noteId) ?? false;
    }
    /**
     * Setup a channel from registry/discovery.
     * Used to initialize state before compilation.
     */
    setupChannel(recipientAddress, channel) {
        debugLog("pool-simulator", "setupChannel", "addr:", toHex(recipientAddress), "incoming publicKey:", channel.publicKey, "incoming key:", channel.key);
        this.channels.set(recipientAddress, new Channel(channel.publicKey, channel.key));
        if (!channel.key)
            return;
        // Copy token nonces from the channel
        for (const [token, nonces] of channel.tokens.entries()) {
            this.channels.get(recipientAddress).tokens.set(token, { ...nonces });
        }
    }
    /**
     * Setup a note from registry.
     * Used to initialize state before compilation.
     */
    setupNote(token, note) {
        this.notes.get(token).set(toBigInt(note.id), note);
    }
    /**
     * Export tracked state back to the registry.
     */
    updateRegistry(registry) {
        for (const [address, channel] of this.channels.entries()) {
            registry.channels.set(address, channel);
        }
        for (const [token, notes] of this.notes.entries()) {
            registry.notes.set(token, Array.from(notes.values()));
        }
        return registry;
    }
    handleSetViewingKey(_input) {
        // Derive the real public key from the viewing key and create self-channel entry
        if (this.userViewingKey !== undefined) {
            const publicKey = derivePublicKey(this.userViewingKey);
            assert(!this.channels.has(this.userAddress), () => `Channel already exists for ${toHex(this.userAddress)}`);
            this.channels.set(this.userAddress, new Channel(publicKey));
        }
        debugLog("pool-simulator", "SetViewingKey", toHex(this.userAddress));
    }
    handleOpenChannel(input) {
        const { recipient_addr } = input;
        // Look up the recipient's public key from the channel set up during setupChannel
        const existingChannel = this.channels.get(recipient_addr);
        assert(existingChannel, () => `Channel not found for recipient ${toHex(recipient_addr)} — setupChannel must be called first`);
        const recipientPublicKey = existingChannel.publicKey;
        // Compute the real channel key using the viewing key from constructor
        const channelKey = compute_channel_key(this.userAddress, toBigInt(this.userViewingKey), recipient_addr, toBigInt(recipientPublicKey));
        // Update channel with computed key
        existingChannel.key = channelKey;
        this.nextChannelIndex++;
        debugLog("pool-simulator", "OpenChannel", toHex(this.userAddress), "->", toHex(recipient_addr));
    }
    handleOpenSubchannel(input) {
        const { recipient_addr, token, index } = input;
        // Update channel's token nonces
        const channel = this.channels.get(recipient_addr);
        channel.tokens.set(token, {
            tokenIndex: index,
            noteNonce: 0,
        });
        debugLog("pool-simulator", "OpenSubchannel", toHex(this.userAddress), "->", toHex(recipient_addr), "token:", toHex(token));
    }
    handleUseNote(input) {
        const { token, channel_key, index } = input;
        // Remove the note from tracking (it's being spent)
        const tokenNotes = this.notes.get(token);
        const noteId = compute_note_id(channel_key, token, index);
        tokenNotes.delete(noteId);
        debugLog("pool-simulator", "UseNote", toHex(this.userAddress), "token:", toHex(token));
    }
    handleCreateEncNote(input) {
        const { recipient_addr, recipient_public_key, token, amount, index, salt } = input;
        // Update sender's channel note nonce
        const senderChannel = this.channels.get(recipient_addr);
        senderChannel.incrementNoteNonce(token);
        // Only track note if this is a self-transfer (recipient is us)
        if (recipient_addr === this.userAddress && this.userViewingKey) {
            // Compute the channel key to generate the note ID
            const channelKey = compute_channel_key(this.userAddress, toBigInt(this.userViewingKey), recipient_addr, toBigInt(recipient_public_key));
            // Compute the proper note ID using the hash function
            const noteId = compute_note_id(channelKey, token, index);
            this.notes.get(token).set(noteId, {
                id: noteId,
                amount: typeof amount === "bigint" ? amount : 0n,
                witness: {
                    channelKey,
                    nonce: index,
                    r: salt,
                },
                sender: this.userAddress,
            });
        }
        debugLog("pool-simulator", "CreateEncNote", toHex(this.userAddress), "->", toHex(recipient_addr), "token:", toHex(token));
    }
    handleCreateOpenNote(input) {
        const { recipient_addr, token } = input;
        // Update sender's channel note nonce (same as CreateEncNote)
        const senderChannel = this.channels.get(recipient_addr);
        senderChannel.incrementNoteNonce(token);
        debugLog("pool-simulator", "CreateOpenNote", toHex(this.userAddress), "->", toHex(recipient_addr), "token:", toHex(token));
    }
}
//# sourceMappingURL=pool-simulator.js.map