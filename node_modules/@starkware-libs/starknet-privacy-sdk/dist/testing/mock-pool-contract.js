/**
 * MockPoolContract - Mock implementation of the privacy pool contract.
 *
 * This class provides:
 * 1. View methods with bigint params (matching Cairo contract felts)
 * 2. compile_actions() returns MockServerAction[] for state mutations
 * 3. apply_actions() applies the mutations
 * 4. snapshot()/restore() for validation pattern
 */
import { derivePublicKey, generateRandom, toBigInt, } from "../utils/crypto.js";
import { encryptions } from "../utils/encryptions.js";
import { AdvancedMap, AddressMap } from "../utils/maps.js";
import { assert, isOpen } from "../utils/validation.js";
import { compute_channel_key, compute_channel_marker, compute_subchannel_id, compute_subchannel_marker, compute_note_id, compute_nullifier, compute_outgoing_channel_id, } from "../utils/hashes.js";
import { toHex } from "../utils/convert.js";
class ChannelsMap extends AdvancedMap {
    constructor() {
        super({
            keyConverter: (key) => `${key.address}:${key.publicKey}`,
            defaultFactory: () => [],
        });
    }
}
export class MockPoolContract {
    address;
    contracts;
    validateBalances;
    serverActions;
    publicKeys = new AddressMap();
    channels = new ChannelsMap();
    channelMarkers = new Set();
    subchannels = new Map();
    subchannelMarkers = new Set();
    notes = new Map();
    nullifiers = new Set();
    outgoingChannels = new Map();
    outgoingChannelCounters = new AddressMap(() => 0);
    // Class hash this mock pool is "deployed" under; heads the proof payload so
    // tests can drive the SDK's class-hash pool-mode detection.
    classHash = "0x0";
    constructor(address, contracts, validateBalances = true, serverActions = []) {
        this.address = address;
        this.contracts = contracts;
        this.validateBalances = validateBalances;
        this.serverActions = serverActions;
    }
    // ============ View Methods (bigint params, matching Cairo contract) ============
    is_registered(address) {
        return this.publicKeys.has(address);
    }
    get_public_key(userAddr) {
        return this.publicKeys.has(userAddr) ? toBigInt(this.publicKeys.get(userAddr)) : 0n;
    }
    get_num_of_channels(recipientAddr) {
        if (!this.publicKeys.has(recipientAddr))
            return 0n;
        const pk = this.publicKeys.get(recipientAddr);
        return BigInt(this.channels.get({ address: recipientAddr, publicKey: pk })?.length ?? 0);
    }
    get_channel_info(recipientAddr, index) {
        const pk = this.publicKeys.get(recipientAddr);
        const channelList = this.channels.get({ address: recipientAddr, publicKey: pk }) ?? [];
        return channelList[index] ?? { ephemeral_pubkey: 0n, enc_channel_key: 0n, enc_sender_addr: 0n };
    }
    get_subchannel_info(subchannelId) {
        return this.subchannels.get(subchannelId) ?? { salt: 0n, enc_token: 0n };
    }
    get_outgoing_channel_info(outgoingChannelId) {
        return this.outgoingChannels.get(outgoingChannelId) ?? { salt: 0n, enc_recipient_addr: 0n };
    }
    get_note(noteId) {
        const note = this.notes.get(noteId);
        if (!note)
            return { packed_value: 0n, token: 0n };
        if ("packed" in note) {
            // Encrypted note: token is zero in the Note struct (privacy)
            return { packed_value: note.packed, token: 0n };
        }
        // Open note: packed_value = (OPEN_NOTE_SALT << 128) | amount, token is non-zero
        const OPEN_NOTE_SALT = 1n;
        const packedValue = (OPEN_NOTE_SALT << 128n) | note.amount;
        return { packed_value: packedValue, token: note.token };
    }
    channel_exists(channelMarker) {
        return this.channelMarkers.has(channelMarker);
    }
    nullifier_exists(nullifier) {
        return this.nullifiers.has(nullifier);
    }
    subchannel_exists(subchannelMarker) {
        return this.subchannelMarkers.has(subchannelMarker);
    }
    get_enc_private_key(_userAddr) {
        // Mock doesn't store encrypted private keys
        return { auditor_public_key: 0n, ephemeral_pubkey: 0n, enc_private_key: 0n };
    }
    get_auditor_public_key() {
        // Mock returns dummy auditor key
        return 1n;
    }
    get_fee_amount() {
        return 0n;
    }
    get_fee_collector() {
        return 0n;
    }
    get_proof_validity_blocks() {
        return 450n;
    }
    // ============ Helper Methods for Discovery ============
    /**
     * Get all encrypted channel info for a recipient.
     */
    get_channels(address) {
        const pk = this.publicKeys.get(address);
        if (!pk)
            return [];
        return this.channels.get({ address, publicKey: pk }) ?? [];
    }
    /**
     * Check if channel exists between two addresses.
     */
    does_channel_exist(channelKey, from, to) {
        const toPublicKey = this.publicKeys.get(to);
        if (!toPublicKey)
            return false;
        return this.channelMarkers.has(compute_channel_marker(channelKey, from, to, toBigInt(toPublicKey)));
    }
    /**
     * Get decrypted token from subchannel.
     * Returns false if subchannel doesn't exist.
     */
    get_token(channelKey, nonce) {
        const subchannelId = compute_subchannel_id(channelKey, nonce);
        const encrypted = this.subchannels.get(subchannelId);
        if (!encrypted)
            return false;
        return encryptions.decryptSubchannelInfo(encrypted, channelKey, nonce).token;
    }
    /**
     * Get decrypted note data.
     * Returns false if note doesn't exist.
     */
    get_decrypted_note(channelKey, index, token) {
        const noteId = compute_note_id(channelKey, token, index);
        const note = this.notes.get(noteId);
        if (note === undefined)
            return false;
        if ("r" in note && note.r == 1n) {
            return { id: noteId, amount: note.amount, r: 1n, open: true };
        }
        const packed = note;
        const { amount, salt } = encryptions.decryptNoteAmount(packed.packed, channelKey, packed.token, packed.index);
        return { id: noteId, amount, r: salt, open: false };
    }
    /**
     * Check if nullifier exists for a given witness.
     */
    has_nullifier(witness, token, privateKey) {
        return this.nullifiers.has(compute_nullifier(witness.channelKey, token, witness.nonce, toBigInt(privateKey)));
    }
    // ============ Execute Methods ============
    /**
     * Execute client actions and return MockServerAction[] that can be replayed.
     * This is a "view" function - pool state changes are rolled back after execution.
     *
     * Pool-state actions are applied temporarily (required for assertions in subsequent
     * actions), then state is restored. Externally-modifying actions (Deposit, Withdraw,
     * InvokeExternal) are deferred and only applied when callbacks are replayed.
     *
     * Validates token totals if validateBalances is true.
     */
    compile_actions(sender, privateKey, clientActions) {
        if (this.validateBalances) {
            this.validateTokenTotals(sender, clientActions);
        }
        const snapshot = this.snapshot();
        const serverActions = [];
        try {
            for (const action of clientActions) {
                const actions = this.execute_action(sender, privateKey, action);
                // Apply pool-state actions immediately (required for assertions in subsequent actions)
                // Defer ERC20-modifying actions - only applied during replay
                for (const serverAction of actions) {
                    if (!serverAction.deferred) {
                        serverAction.apply();
                    }
                    serverActions.push(serverAction);
                }
            }
        }
        finally {
            // Restore pool state - this is a view function
            this.restore(snapshot);
        }
        return serverActions;
    }
    /**
     * Apply server actions to mutate state.
     *
     * Mirrors the on-chain calldata shape. Against a screening-capable pool the
     * action span is followed by a Serde-encoded Option<ScreeningAttestation> —
     * [0x1] when absent, [0x0, issued_at, sig_r, sig_s] when present (Cairo's
     * Option Serde: Some=0, None=1). Against the current pool there is no suffix
     * at all (compatibility mode).
     */
    apply_actions(calldata) {
        const actionCount = this.serverActions.length;
        for (let i = 0; i < actionCount; i++) {
            assert(this.serverActions[i].type == calldata[i], () => `Server action ${calldata[i]} does not match expected ${this.serverActions[i].type}`);
            this.serverActions[i].apply();
        }
        this.serverActions = [];
        const screeningSuffix = calldata.slice(actionCount);
        const isCompatibility = screeningSuffix.length == 0;
        const isNoneAttestation = screeningSuffix.length == 1 && screeningSuffix[0] == "0x1";
        const isSomeAttestation = screeningSuffix.length == 4 && screeningSuffix[0] == "0x0";
        assert(isCompatibility || isNoneAttestation || isSomeAttestation, () => `Malformed screening attestation suffix: [${screeningSuffix.join(", ")}]`);
    }
    /**
     * Returns MockServerAction[] that have already been applied.
     */
    execute(sender, privateKey, ...clientActions) {
        const actions = this.compile_actions(sender, privateKey, clientActions);
        this.serverActions = actions;
        return this.serverActions.map((action) => action.type);
    }
    /**
     *
     * @param from  since there's no support for getting the caller address, need an explicit parameter
     */
    openDeposit(noteId, token, amount, from) {
        this.contracts.get(token).transfer(from, this.address, amount);
        const note = this.notes.get(noteId);
        assert(note, () => `Note ${toHex(noteId)} does not exist`);
        assert(note.r == 1n, () => `Note ${toHex(noteId)} is not open`);
        assert(note.token == token, () => `Note ${toHex(noteId)} is not for token ${token}`);
        assert(note.amount == 0n, () => `Note ${toHex(noteId)} has already been filled`);
        note.amount = amount;
    }
    // ============ Setup Methods (for compiler) ============
    setupChannel(userAddress, viewingKey, address, index, channel) {
        this.publicKeys.set(address, channel.publicKey);
        if (!channel.key)
            return;
        this.setChannel(userAddress, viewingKey, address, channel.publicKey, index, generateRandom()).apply();
        for (const [token, nonces] of channel.tokens.entries()) {
            this.setToken(userAddress, address, channel.publicKey, channel.key, token, nonces.tokenIndex, generateRandom()).apply();
            if (nonces.noteNonce > 0) {
                this.notes.set(compute_note_id(channel.key, token, nonces.noteNonce - 1), {
                    r: 1n,
                    amount: 0n,
                    token,
                });
            }
        }
    }
    setupNote(userAddress, note, token) {
        this.subchannelMarkers.add(compute_subchannel_marker(note.witness.channelKey, userAddress, this.get_public_key(userAddress), token));
        const noteIndex = note.witness.nonce;
        this.notes.set(note.id, note.open
            ? { r: 1n, amount: note.amount, token }
            : {
                packed: encryptions.encryptNoteAmount(note.witness.channelKey, token, noteIndex, note.witness.r, note.amount),
                token,
                index: noteIndex,
            });
    }
    // ============ Snapshot/Restore ============
    snapshot() {
        const channelsSnapshot = new Map();
        for (const [key, arr] of this.channels.entries()) {
            channelsSnapshot.set(key, [...arr]);
        }
        const notesSnapshot = new Map();
        for (const [key, note] of this.notes) {
            notesSnapshot.set(key, { ...note });
        }
        return {
            publicKeys: new Map(this.publicKeys.entries()),
            channels: channelsSnapshot,
            channelMarkers: new Set(this.channelMarkers),
            subchannels: new Map(this.subchannels),
            subchannelMarkers: new Set(this.subchannelMarkers),
            notes: notesSnapshot,
            nullifiers: new Set(this.nullifiers),
            outgoingChannels: new Map(this.outgoingChannels),
        };
    }
    restore(snapshot) {
        const s = snapshot;
        this.publicKeys.clear();
        for (const [k, v] of s.publicKeys)
            this.publicKeys.set(k, v);
        this.channels.clear();
        for (const [strKey, value] of s.channels) {
            const [address, publicKey] = strKey.split(":");
            this.channels.set({ address: toBigInt(address), publicKey: toBigInt(publicKey) }, value);
        }
        this.channelMarkers = new Set(s.channelMarkers);
        this.subchannels = new Map(s.subchannels);
        this.subchannelMarkers = new Set(s.subchannelMarkers);
        this.notes = new Map(s.notes);
        this.nullifiers = new Set(s.nullifiers);
        this.outgoingChannels = new Map(s.outgoingChannels);
    }
    // ============ Private Methods ============
    assertRegistered(address) {
        if (!this.publicKeys.has(address)) {
            throw new Error(`Address ${toHex(address)} is not registered`);
        }
    }
    execute_action(sender, privateKey, action) {
        switch (action.type) {
            case "SetViewingKey":
                return [this.register(sender, privateKey, action.input.random)];
            case "OpenChannel": {
                const recipientPublicKey = this.publicKeys.get(action.input.recipient_addr);
                assert(recipientPublicKey !== undefined, () => `Recipient ${toHex(action.input.recipient_addr)} not registered — no public key`);
                return [
                    this.setChannel(sender, privateKey, action.input.recipient_addr, recipientPublicKey, action.input.index, action.input.random),
                ];
            }
            case "OpenSubchannel":
                return [
                    this.setToken(sender, action.input.recipient_addr, action.input.recipient_public_key, action.input.channel_key, action.input.token, action.input.index, action.input.salt),
                ];
            case "Deposit": {
                return [this.deposit(sender, action.input.token, action.input.amount)];
            }
            case "UseNote":
                return [
                    this.useNote(sender, privateKey, action.input.token, action.input.channel_key, action.input.index),
                ];
            case "CreateEncNote":
                return [
                    this.createEncNote(sender, privateKey, action.input.recipient_addr, action.input.recipient_public_key, action.input.token, action.input.index, action.input.amount, action.input.salt),
                ];
            case "CreateOpenNote":
                return [
                    this.createOpenNote(sender, privateKey, action.input.recipient_addr, action.input.recipient_public_key, action.input.token, action.input.index),
                ];
            case "Withdraw":
                return [this.withdraw(action.input.token, action.input.to_addr, action.input.amount)];
            case "InvokeExternal":
                return [this.invoke(action.input.contract_address, action.input.calldata)];
            default:
                throw new Error(`Unsupported action type in mock: ${action.type}`);
        }
    }
    register(address, privateKey, _random) {
        const publicKey = derivePublicKey(privateKey);
        return {
            type: "SetViewingKey",
            apply: () => {
                // Matches Cairo's to_write_once_action - fails if public key already set
                assert(!this.publicKeys.has(address), () => `User ${toHex(address)} already registered`);
                this.publicKeys.set(address, publicKey);
            },
        };
    }
    setChannel(from, fromPrivateKey, to, toPublicKey, index, random) {
        this.assertRegistered(from);
        const channelKey = compute_channel_key(from, toBigInt(fromPrivateKey), to, toBigInt(toPublicKey));
        const channelInfo = encryptions.encryptChannelInfo(random, toBigInt(toPublicKey), channelKey, from);
        assert(index >= 0, () => `Outgoing channel index must be non-negative: ${index}`);
        if (index > 0) {
            const prevOutgoingChannelId = compute_outgoing_channel_id(from, toBigInt(fromPrivateKey), index - 1);
            assert(this.outgoingChannels.has(prevOutgoingChannelId), () => `Outgoing channel index ${index} is not sequential for sender ${toHex(from)}`);
        }
        const outgoingChannelId = compute_outgoing_channel_id(from, toBigInt(fromPrivateKey), index);
        const outgoingSalt = generateRandom();
        const encOutgoingChannelInfo = encryptions.encryptOutgoingChannelInfo(from, toBigInt(fromPrivateKey), index, to, outgoingSalt);
        const channelMarker = compute_channel_marker(channelKey, from, to, toBigInt(toPublicKey));
        return {
            type: "OpenChannel",
            apply: () => {
                // Matches Cairo's WriteOnce for channel_exists - fails if channel already exists
                assert(!this.channelMarkers.has(channelMarker), () => `Channel ${toHex(channelMarker)} already exists`);
                this.channels.get({ address: to, publicKey: toPublicKey }).push(channelInfo);
                this.channelMarkers.add(channelMarker);
                this.outgoingChannels.set(outgoingChannelId, encOutgoingChannelInfo);
            },
        };
    }
    setToken(from, to, toPublicKey, channelKey, token, index, random) {
        this.assertRegistered(from);
        assert(this.channelMarkers.has(compute_channel_marker(channelKey, from, to, toBigInt(toPublicKey))), () => `Channel does not exist between ${from} and ${to}`);
        assert(index == 0 || this.subchannels.has(compute_subchannel_id(channelKey, index - 1)), () => `Nonce ${index} is not sequential`);
        const subchannelId = compute_subchannel_id(channelKey, index);
        assert(!this.subchannels.has(subchannelId), () => `Token ${toHex(token)} already exists`);
        const subchannelMarker = compute_subchannel_marker(channelKey, to, toBigInt(toPublicKey), token);
        const encryptedSubchannelInfo = encryptions.encryptSubchannelInfo(channelKey, index, token, random);
        return {
            type: "OpenSubchannel",
            apply: () => {
                assert(!this.subchannelMarkers.has(subchannelMarker), () => `Subchannel ${toHex(subchannelMarker)} already exists`);
                this.subchannels.set(subchannelId, encryptedSubchannelInfo);
                this.subchannelMarkers.add(subchannelMarker);
            },
        };
    }
    useNote(owner, ownerPrivateKey, token, channelKey, index) {
        const ownerPublicKey = this.get_public_key(owner);
        assert(this.subchannelMarkers.has(compute_subchannel_marker(channelKey, owner, ownerPublicKey, token)), () => `Token ${token} does not exist`);
        const noteId = compute_note_id(channelKey, token, index);
        assert(this.notes.has(noteId), () => `Note ${noteId} does not exist`);
        const nullifier = compute_nullifier(channelKey, token, index, toBigInt(ownerPrivateKey));
        return {
            type: "UseNote",
            apply: () => {
                // Matches Cairo's WriteOnce for nullifier - fails if nullifier already exists
                assert(!this.nullifiers.has(nullifier), () => `Nullifier ${nullifier} already exists`);
                this.nullifiers.add(nullifier);
            },
        };
    }
    createEncNote(sender, senderPrivateKey, to, toPublicKey, token, index, amount, random) {
        const channelKey = compute_channel_key(sender, toBigInt(senderPrivateKey), to, toBigInt(toPublicKey));
        const subchannelMarker = compute_subchannel_marker(channelKey, to, toBigInt(toPublicKey), token);
        assert(this.subchannelMarkers.has(subchannelMarker), () => `Token ${token} does not exist`);
        assert(index == 0 || this.notes.has(compute_note_id(channelKey, token, index - 1)), () => `Nonce ${index} is not sequential`);
        const noteId = compute_note_id(channelKey, token, index);
        const noteData = {
            packed: encryptions.encryptNoteAmount(channelKey, token, index, random, amount),
            token,
            index,
        };
        return {
            type: "CreateEncNote",
            apply: () => {
                // Matches Cairo's to_write_once_action for note - fails if note already exists
                assert(!this.notes.has(noteId), () => `Note ${noteId} already exists`);
                this.notes.set(noteId, noteData);
            },
        };
    }
    createOpenNote(sender, senderPrivateKey, to, toPublicKey, token, index) {
        const channelKey = compute_channel_key(sender, toBigInt(senderPrivateKey), to, toBigInt(toPublicKey));
        const subchannelMarker = compute_subchannel_marker(channelKey, to, toBigInt(toPublicKey), token);
        assert(this.subchannelMarkers.has(subchannelMarker), () => `Token ${token} does not exist`);
        assert(index == 0 || this.notes.has(compute_note_id(channelKey, token, index - 1)), () => `Nonce ${index} is not sequential`);
        const noteId = compute_note_id(channelKey, token, index);
        assert(!this.notes.has(noteId), () => `Note ${noteId} already exists`);
        // Open note: r=1n marker, amount=0n (to be filled by depositor), token
        const noteData = { r: 1n, amount: 0n, token };
        return {
            type: "CreateOpenNote",
            apply: () => {
                this.notes.set(noteId, noteData);
            },
        };
    }
    deposit(from, token, amount) {
        return {
            type: "Deposit",
            apply: () => this.contracts.get(token).transfer(from, this.address, amount),
            deferred: true,
        };
    }
    withdraw(token, recipient, amount) {
        return {
            type: "Withdraw",
            apply: () => this.contracts.get(token).transfer(this.address, recipient, amount),
            deferred: true,
        };
    }
    invoke(contractAddress, calldata) {
        return {
            type: "InvokeExternal",
            apply: () => {
                const entrypoint = "privacy_invoke";
                this.contracts.call(contractAddress, entrypoint, calldata);
            },
            deferred: true,
        };
    }
    validateTokenTotals(sender, clientActions) {
        const runningTotals = new Map();
        const updateTotal = (token, delta) => {
            const current = runningTotals.get(token) ?? 0n;
            const updated = current + delta;
            assert(updated >= 0n, () => `Running total for token ${toHex(token)} went negative: ${updated}`);
            runningTotals.set(token, updated);
        };
        for (const action of clientActions) {
            switch (action.type) {
                case "Deposit":
                    assert(action.input.amount >= 0n, () => `Deposit amount must be non-negative: ${action.input.amount}`);
                    if (!("noteId" in action.input) || action.input.noteId === undefined) {
                        updateTotal(action.input.token, action.input.amount);
                    }
                    break;
                case "UseNote": {
                    const noteData = this.get_decrypted_note(action.input.channel_key, action.input.index, action.input.token);
                    assert(noteData, () => `Note not found`);
                    assert(!noteData.open, () => `Cannot use open note as input`);
                    updateTotal(action.input.token, noteData.amount);
                    break;
                }
                case "CreateEncNote": {
                    const amount = action.input.amount;
                    if (!isOpen(amount)) {
                        assert(amount >= 0n, () => `CreateEncNote amount must be non-negative: ${amount}`);
                        updateTotal(action.input.token, -amount);
                    }
                    break;
                }
                case "Withdraw":
                    assert(action.input.amount >= 0n, () => `Withdraw amount must be non-negative: ${action.input.amount}`);
                    updateTotal(action.input.token, -action.input.amount);
                    break;
                default:
                    break;
            }
        }
        for (const [token, total] of runningTotals.entries()) {
            assert(total === 0n, () => `Final total for token ${toHex(token)} is ${total}, expected 0`);
        }
    }
}
//# sourceMappingURL=mock-pool-contract.js.map