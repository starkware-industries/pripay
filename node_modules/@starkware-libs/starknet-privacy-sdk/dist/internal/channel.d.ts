import { BlockIdentifier } from "starknet";
import { SetupRequirement, StarknetAddressBigint, type ChannelSerde, type StarknetAddress, type WitnessSerde } from "../interfaces.js";
import { AddressMap } from "../utils/maps.js";
import { PublicKey } from "../utils/crypto.js";
/**
 * Tracks nonces for a token subchannel within a channel.
 * - tokenIndex: identifies which subchannel (fixed, part of the ID)
 * - noteNonce: next note index to use (advances as notes are created)
 */
export type TokenChannel = {
    tokenIndex: number;
    noteNonce: number;
};
export type IncomingChannelCursor = {
    channelKey: ChannelKey;
    subchannelIdIndex: number;
    noteIndexes: AddressMap<number>;
    totalNoteCounts: AddressMap<number>;
};
export type NotesCursor = {
    blockId: BlockIdentifier;
    incomingChannels: AddressMap<IncomingChannelCursor>;
};
export declare function cloneNotesCursor(cursor?: NotesCursor): NotesCursor;
export type RecipientsFilter<T = StarknetAddressBigint> = T[] | "all" | "total-only";
export type ChannelCursor = {
    channels?: AddressMap<Channel>;
    total?: number;
};
export declare function cloneChannelCursor(cursor?: ChannelCursor): ChannelCursor;
type ChannelKey = bigint;
/** Channel containing nonces for token and note creation. */
export declare class Channel {
    readonly publicKey: PublicKey;
    key?: ChannelKey;
    readonly tokens: AddressMap<TokenChannel>;
    constructor(publicKey: PublicKey, key?: ChannelKey, tokens?: Iterable<[StarknetAddress, TokenChannel]>);
    incrementNoteNonce(token: StarknetAddress): number;
    /** Create a deep clone of this channel */
    clone(): Channel;
    toSetupRequirement(token: StarknetAddressBigint): SetupRequirement;
}
export declare const channelSerde: ChannelSerde;
/** Witness for a note, containing channel key and nonce. */
export declare class Witness {
    readonly channelKey: ChannelKey;
    readonly nonce: number;
    readonly r: bigint;
    constructor(channelKey: ChannelKey, nonce: number, r: bigint);
}
export declare const witnessSerde: WitnessSerde;
export {};
//# sourceMappingURL=channel.d.ts.map