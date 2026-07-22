import type { BlockIdentifier } from "starknet";
import { SetupRequirement, type Channel as ChannelInterface, type Note, type StarknetAddress, type StarknetAddressBigint, type ViewingKey } from "../interfaces.js";
import { AddressMap } from "../utils/maps.js";
import { AbstractDiscoveryProvider } from "./abstract-discovery.js";
import type { ChannelCursor, IncomingChannelCursor, NotesCursor, RecipientsFilter } from "./channel.js";
import type { HistoryCursor, HistoryPage } from "./history.js";
type ApiSubchannelCursor = {
    note_discovery_complete?: boolean;
    last_note_index?: number;
    total_n_notes?: number;
};
type ApiChannelCursor = {
    channel_key?: string;
    subchannel_discovery_complete?: boolean;
    last_subchannel_index?: number;
    subchannels?: Record<string, ApiSubchannelCursor>;
};
type ApiDiscoveryCursor = {
    channel_discovery_complete?: boolean;
    total_n_channels?: number;
    last_channel_index?: number;
    channels?: Record<string, ApiChannelCursor>;
};
type ApiIncomingNoteInfo = {
    sender_addr: string;
    token: string;
    index: number;
    note_id: string;
    amount: string;
    salt: string;
    block_number: number;
};
export type DiscoveryHealthResponse = {
    status: string;
    chain_head?: {
        block_number: number;
        block_hash: string;
        timestamp: number;
    };
    lag_secs?: number;
};
export declare class IndexerDiscoveryProvider extends AbstractDiscoveryProvider {
    private readonly apiUrl;
    private readonly contractAddress;
    private readonly ohttpClient?;
    constructor(apiUrl: string, contractAddress: StarknetAddress, options?: {
        ohttp?: boolean | {
            relayUrl?: string;
            publicKeyConfig?: Uint8Array;
        };
    });
    isHealthy(): Promise<boolean>;
    getHealth(): Promise<DiscoveryHealthResponse>;
    discoverNotes(address: StarknetAddressBigint, viewingKey: ViewingKey, params?: {
        cursor?: NotesCursor;
        tokens?: StarknetAddressBigint[];
        blockIdentifier?: BlockIdentifier;
    }): Promise<{
        timestamp: BlockIdentifier;
        notes: AddressMap<Note[]>;
        cursor: NotesCursor;
    }>;
    discoverChannels(address: StarknetAddressBigint, viewingKey: ViewingKey, recipients: RecipientsFilter, params?: {
        cursor?: ChannelCursor;
        blockIdentifier?: BlockIdentifier;
    }): Promise<{
        timestamp: BlockIdentifier;
        channels?: AddressMap<ChannelInterface>;
        total?: number;
    }>;
    discoverRequirement(address: StarknetAddressBigint, viewingKey: ViewingKey, recipient: StarknetAddressBigint, token: StarknetAddressBigint): Promise<SetupRequirement>;
    fetchHistory(userAddress: StarknetAddressBigint, notesCursor: NotesCursor, channelCursor: ChannelCursor, options?: {
        maxTransactions?: number;
        lastKnownBlock?: string;
        blockIdentifier?: BlockIdentifier;
        /** Pass the cursor from a previous HistoryPage to continue pagination. */
        historyCursor?: HistoryCursor;
    }): Promise<HistoryPage>;
    private get;
    private post;
}
/** Builds `Record<string, ApiSubchannelCursor>` from token→noteIndex pairs, optionally filtered. */
export declare function buildSubchannelCursors(noteIndexes: Iterable<[StarknetAddressBigint, number]>, tokenFilter: Set<bigint> | null, totalNoteCounts?: AddressMap<number>): Record<string, ApiSubchannelCursor>;
/** Converts SDK `NotesCursor` -> API cursor for an incoming sync request. */
export declare function notesCursorToApiCursor(cursor: NotesCursor, tokenFilter: Set<bigint> | null): ApiDiscoveryCursor;
/** Converts API cursor from an incoming sync response → SDK `NotesCursor`. */
export declare function apiCursorToNotesCursor(apiCursor: ApiDiscoveryCursor, blockRef: BlockIdentifier): NotesCursor;
/** Converts SDK `AddressMap<Channel>` → API cursor for an outgoing sync request. */
export declare function channelMapToApiCursor(channels: AddressMap<ChannelInterface> | undefined, channelDiscoveryComplete: boolean): ApiDiscoveryCursor;
/** Converts API incoming notes → SDK `Note` objects grouped by token. */
export declare function convertIncomingNotes(apiNotes: ApiIncomingNoteInfo[], channelKeyMap: Map<string, bigint>, existingChannels: AddressMap<IncomingChannelCursor>, tokenFilter: Set<bigint> | null): AddressMap<Note[]>;
export {};
//# sourceMappingURL=indexer-discovery.d.ts.map