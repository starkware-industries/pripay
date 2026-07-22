/**
 * MockPoolContract - Mock implementation of the privacy pool contract.
 *
 * This class provides:
 * 1. View methods with bigint params (matching Cairo contract felts)
 * 2. compile_actions() returns MockServerAction[] for state mutations
 * 3. apply_actions() applies the mutations
 * 4. snapshot()/restore() for validation pattern
 */
import type { Amount, Note, StarknetAddressBigint } from "../interfaces.js";
import { Witness } from "../interfaces.js";
import { Channel } from "../internal/channel.js";
import { type Hash, type PrivateKey as ViewingKey, type PublicKey, ChannelKey } from "../utils/crypto.js";
import type { PoolContractInterface, EncChannelInfo, EncSubchannelInfo, EncOutgoingChannelInfo, EncPrivateKey } from "../internal/pool-contract-interface.js";
import type { MockContracts, MockContract } from "./contracts.js";
import { ClientAction } from "../internal/client-actions.js";
type OpenNote = {
    r: bigint;
    amount: Amount;
    token: StarknetAddressBigint;
};
type MockServerAction = {
    /** Action type for debugging/logging (e.g., "WriteIfZero", "AppendToVec") */
    type: string;
    /** Closure that performs the state mutation */
    apply: () => void;
    /** actions that shouldn't be applied in the private side */
    deferred?: boolean;
};
type EncryptedNote = {
    packed: bigint;
    token: StarknetAddressBigint;
    index: number;
};
export type MockPoolContractSnapshot = {
    publicKeys: Map<StarknetAddressBigint, PublicKey>;
    channels: Map<string, EncChannelInfo[]>;
    channelMarkers: Set<Hash>;
    subchannels: Map<Hash, EncSubchannelInfo>;
    subchannelMarkers: Set<Hash>;
    notes: Map<Hash, EncryptedNote | OpenNote>;
    nullifiers: Set<Hash>;
    outgoingChannels: Map<bigint, EncOutgoingChannelInfo>;
};
export declare class MockPoolContract implements MockContract, PoolContractInterface {
    address: StarknetAddressBigint;
    private contracts;
    private validateBalances;
    private serverActions;
    private publicKeys;
    private channels;
    private channelMarkers;
    private subchannels;
    private subchannelMarkers;
    private notes;
    private nullifiers;
    private outgoingChannels;
    private outgoingChannelCounters;
    classHash: string;
    [key: string]: unknown;
    constructor(address: StarknetAddressBigint, contracts: MockContracts, validateBalances?: boolean, serverActions?: MockServerAction[]);
    is_registered(address: StarknetAddressBigint): boolean;
    get_public_key(userAddr: StarknetAddressBigint): bigint;
    get_num_of_channels(recipientAddr: StarknetAddressBigint): bigint;
    get_channel_info(recipientAddr: StarknetAddressBigint, index: number): EncChannelInfo;
    get_subchannel_info(subchannelId: bigint): EncSubchannelInfo;
    get_outgoing_channel_info(outgoingChannelId: bigint): EncOutgoingChannelInfo;
    get_note(noteId: bigint): {
        packed_value: bigint;
        token: StarknetAddressBigint;
    };
    channel_exists(channelMarker: bigint): boolean;
    nullifier_exists(nullifier: bigint): boolean;
    subchannel_exists(subchannelMarker: bigint): boolean;
    get_enc_private_key(_userAddr: StarknetAddressBigint): EncPrivateKey;
    get_auditor_public_key(): bigint;
    get_fee_amount(): bigint | number;
    get_fee_collector(): bigint;
    get_proof_validity_blocks(): bigint | number;
    /**
     * Get all encrypted channel info for a recipient.
     */
    get_channels(address: StarknetAddressBigint): EncChannelInfo[];
    /**
     * Check if channel exists between two addresses.
     */
    does_channel_exist(channelKey: bigint, from: StarknetAddressBigint, to: StarknetAddressBigint): boolean;
    /**
     * Get decrypted token from subchannel.
     * Returns false if subchannel doesn't exist.
     */
    get_token(channelKey: Hash, nonce: number): StarknetAddressBigint | false;
    /**
     * Get decrypted note data.
     * Returns false if note doesn't exist.
     */
    get_decrypted_note(channelKey: ChannelKey, index: number, token: StarknetAddressBigint): {
        id: bigint;
        amount: Amount;
        r: bigint;
        open: boolean;
    } | false;
    /**
     * Check if nullifier exists for a given witness.
     */
    has_nullifier(witness: Witness, token: StarknetAddressBigint, privateKey: ViewingKey): boolean;
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
    compile_actions(sender: StarknetAddressBigint, privateKey: bigint, clientActions: ClientAction[]): MockServerAction[];
    /**
     * Apply server actions to mutate state.
     *
     * Mirrors the on-chain calldata shape. Against a screening-capable pool the
     * action span is followed by a Serde-encoded Option<ScreeningAttestation> —
     * [0x1] when absent, [0x0, issued_at, sig_r, sig_s] when present (Cairo's
     * Option Serde: Some=0, None=1). Against the current pool there is no suffix
     * at all (compatibility mode).
     */
    apply_actions(calldata: string[]): void;
    /**
     * Returns MockServerAction[] that have already been applied.
     */
    execute(sender: StarknetAddressBigint, privateKey: bigint, ...clientActions: ClientAction[]): string[];
    /**
     *
     * @param from  since there's no support for getting the caller address, need an explicit parameter
     */
    openDeposit(noteId: bigint, token: bigint, amount: Amount, from: StarknetAddressBigint): void;
    setupChannel(userAddress: StarknetAddressBigint, viewingKey: ViewingKey, address: StarknetAddressBigint, index: number, channel: Channel): void;
    setupNote(userAddress: StarknetAddressBigint, note: Note, token: StarknetAddressBigint): void;
    snapshot(): MockPoolContractSnapshot;
    restore(snapshot: unknown): void;
    private assertRegistered;
    private execute_action;
    private register;
    private setChannel;
    private setToken;
    private useNote;
    private createEncNote;
    private createOpenNote;
    private deposit;
    private withdraw;
    private invoke;
    private validateTokenTotals;
}
export {};
//# sourceMappingURL=mock-pool-contract.d.ts.map