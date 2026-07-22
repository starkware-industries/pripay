/**
 * Hash utility functions for privacy operations.
 * AUTO-GENERATED from packages/privacy/src/hashes.cairo
 * To regenerate: npx tsx scripts/generate-hashes.ts
 */
/** See packages/privacy/src/hashes.cairo for documentation. */
export declare function compute_enc_private_key_hash(shared_x: bigint): bigint;
/** See packages/privacy/src/hashes.cairo for documentation. */
export declare function compute_enc_user_addr_hash(shared_x: bigint): bigint;
/** See packages/privacy/src/hashes.cairo for documentation. */
export declare function compute_enc_token_hash(channel_key: bigint, index: number, salt: bigint): bigint;
/** See packages/privacy/src/hashes.cairo for documentation. */
export declare function compute_enc_channel_key_hash(shared_x: bigint): bigint;
/** See packages/privacy/src/hashes.cairo for documentation. */
export declare function compute_enc_sender_addr_hash(shared_x: bigint): bigint;
/** See packages/privacy/src/hashes.cairo for documentation. */
export declare function compute_enc_recipient_addr_hash(sender_addr: bigint, sender_private_key: bigint, index: number, salt: bigint): bigint;
/** See packages/privacy/src/hashes.cairo for documentation. */
export declare function compute_channel_key(sender_addr: bigint, sender_private_key: bigint, recipient_addr: bigint, recipient_public_key: bigint): bigint;
/** See packages/privacy/src/hashes.cairo for documentation. */
export declare function compute_outgoing_channel_id(sender_addr: bigint, sender_private_key: bigint, index: number): bigint;
/** See packages/privacy/src/hashes.cairo for documentation. */
export declare function compute_channel_marker(channel_key: bigint, sender_addr: bigint, recipient_addr: bigint, recipient_public_key: bigint): bigint;
/** See packages/privacy/src/hashes.cairo for documentation. */
export declare function compute_subchannel_id(channel_key: bigint, index: number): bigint;
/** See packages/privacy/src/hashes.cairo for documentation. */
export declare function compute_subchannel_marker(channel_key: bigint, recipient_addr: bigint, recipient_public_key: bigint, token: bigint): bigint;
/** See packages/privacy/src/hashes.cairo for documentation. */
export declare function compute_note_id(channel_key: bigint, token: bigint, index: number): bigint;
/** See packages/privacy/src/hashes.cairo for documentation. */
export declare function compute_enc_amount_hash(channel_key: bigint, token: bigint, index: number, salt: bigint): bigint;
/** See packages/privacy/src/hashes.cairo for documentation. */
export declare function compute_nullifier(channel_key: bigint, token: bigint, index: number, owner_private_key: bigint): bigint;
//# sourceMappingURL=hashes.d.ts.map