/**
 * Encryption/decryption utilities for privacy operations.
 * Names and formulas match the Cairo implementation in packages/privacy/src/utils.cairo
 *
 * Cairo uses field arithmetic (mod FIELD_PRIME), not curve order arithmetic.
 */
import { BigNumberish } from "starknet";
import type { EncChannelInfo, EncSubchannelInfo, EncOutgoingChannelInfo } from "../internal/pool-contract-interface.js";
export type { EncChannelInfo, EncSubchannelInfo, EncOutgoingChannelInfo };
/** Decrypted channel information */
export type ChannelInfo = {
    key: bigint;
    sender: bigint;
};
/** Decrypted subchannel information */
export type SubchannelInfo = {
    token: bigint;
    salt: bigint;
};
/** Decrypted outgoing channel information */
export type OutgoingChannelInfo = {
    recipientAddr: bigint;
    salt: bigint;
};
/** Encrypted private key (matches Cairo EncPrivateKey struct) */
export type EncPrivateKey = {
    ephemeralPubkey: bigint;
    encPrivateKey: bigint;
};
/** Encrypted user address (matches Cairo EncUserAddr struct) */
export type EncUserAddr = {
    ephemeralPubkey: bigint;
    encUserAddr: bigint;
};
export declare const encryptions: {
    /**
     * Encrypt channel info using ECDH.
     * Matches Cairo's encrypt_channel_info in utils.cairo.
     *
     * @param ephemeralSecret - Random scalar for ECDH
     * @param recipientPublicKey - Recipient's public key (x-coordinate)
     * @param channelKey - The channel key to encrypt
     * @param senderAddr - The sender's address to encrypt
     */
    encryptChannelInfo: (ephemeralSecret: bigint, recipientPublicKey: bigint, channelKey: bigint, senderAddr: bigint) => EncChannelInfo;
    /**
     * Decrypt channel info using ECDH.
     * Matches Cairo's decryption of EncChannelInfo.
     *
     * @param encrypted - The encrypted channel info
     * @param recipientPrivateKey - The recipient's private key
     */
    decryptChannelInfo: (encrypted: EncChannelInfo, recipientPrivateKey: BigNumberish) => ChannelInfo;
    /**
     * Encrypt subchannel info.
     * Matches Cairo's encrypt_subchannel_info in utils.cairo.
     *
     * enc_token = h(ENC_TOKEN_TAG, channel_key, index, 0, salt) + token
     *
     * @param channelKey - The channel key
     * @param index - The subchannel index
     * @param token - The token address to encrypt
     * @param salt - Random salt for encryption
     */
    encryptSubchannelInfo: (channelKey: bigint, index: number, token: bigint, salt: bigint) => EncSubchannelInfo;
    /**
     * Decrypt subchannel info.
     * Inverse of encrypt_subchannel_info.
     *
     * token = enc_token - h(ENC_TOKEN_TAG, channel_key, index, 0, salt)
     *
     * @param encrypted - The encrypted subchannel info (with salt and enc_token fields)
     * @param channelKey - The channel key
     * @param index - The subchannel index
     * @returns Decrypted token and salt
     */
    decryptSubchannelInfo: (encrypted: EncSubchannelInfo, channelKey: bigint, index: number) => SubchannelInfo;
    /**
     * Encrypt note amount.
     * Matches Cairo's enc_note_packed_value in utils.cairo.
     *
     * Result is packed: (salt << 128) | enc_amount
     * enc_amount = (hash + amount) % 2^128
     *
     * @param channelKey - The channel key
     * @param token - The token address
     * @param index - The note index
     * @param salt - Random salt (must be 120 bits)
     * @param amount - The amount to encrypt
     */
    encryptNoteAmount: (channelKey: bigint, token: bigint, index: number, salt: bigint, amount: bigint) => bigint;
    /**
     * Decrypt note amount.
     * Matches Cairo's decrypt_note_amount in utils.cairo.
     *
     * @param encNoteValue - The packed encrypted value (salt || enc_amount)
     * @param channelKey - The channel key
     * @param token - The token address
     * @param index - The note index
     * @returns Object with decrypted amount and extracted salt
     */
    decryptNoteAmount: (encNoteValue: bigint, channelKey: bigint, token: bigint, index: number) => {
        amount: bigint;
        salt: bigint;
    };
    /**
     * Derive public key from private key (returns x-coordinate).
     * Matches Cairo's derive_public_key in utils.cairo.
     */
    derivePublicKey: (privateKey: bigint) => bigint;
    /**
     * Encrypt outgoing channel info.
     * Matches Cairo's encrypt_outgoing_channel_info in utils.cairo.
     *
     * enc_recipient_addr = h(ENC_RECIPIENT_ADDR_TAG, sender_addr, sender_private_key, index, salt) + recipient_addr
     *
     * @param senderAddr - The sender's address
     * @param senderPrivateKey - The sender's private key
     * @param index - The channel index
     * @param recipientAddr - The recipient's address to encrypt
     * @param salt - Random salt for encryption
     */
    encryptOutgoingChannelInfo: (senderAddr: bigint, senderPrivateKey: bigint, index: number, recipientAddr: bigint, salt: bigint) => EncOutgoingChannelInfo;
    /**
     * Decrypt outgoing channel info.
     * Inverse of encrypt_outgoing_channel_info.
     *
     * @param encrypted - The encrypted outgoing channel info
     * @param senderAddr - The sender's address
     * @param senderPrivateKey - The sender's private key
     * @param index - The channel index
     */
    decryptOutgoingChannelInfo: (encrypted: EncOutgoingChannelInfo, senderAddr: BigNumberish, senderPrivateKey: BigNumberish, index: number) => OutgoingChannelInfo;
    /**
     * Encrypt private key using ECDH.
     * Matches Cairo's encrypt_private_key in utils.cairo.
     *
     * @param ephemeralSecret - Random scalar for ECDH
     * @param auditorPublicKey - Auditor's public key (x-coordinate)
     * @param privateKey - The private key to encrypt
     */
    encryptPrivateKey: (ephemeralSecret: bigint, auditorPublicKey: bigint, privateKey: bigint) => EncPrivateKey;
    /**
     * Decrypt private key using ECDH.
     * Inverse of encrypt_private_key.
     *
     * @param encrypted - The encrypted private key
     * @param auditorPrivateKey - The auditor's private key
     */
    decryptPrivateKey: (encrypted: EncPrivateKey, auditorPrivateKey: bigint) => bigint;
    /**
     * Encrypt user address using ECDH.
     * Matches Cairo's encrypt_user_addr in utils.cairo.
     *
     * @param ephemeralSecret - Random scalar for ECDH
     * @param auditorPublicKey - Auditor's public key (x-coordinate)
     * @param userAddr - The user address to encrypt
     */
    encryptUserAddr: (ephemeralSecret: bigint, auditorPublicKey: bigint, userAddr: bigint) => EncUserAddr;
    /**
     * Decrypt user address using ECDH.
     * Inverse of encrypt_user_addr.
     *
     * @param encrypted - The encrypted user address
     * @param auditorPrivateKey - The auditor's private key
     */
    decryptUserAddr: (encrypted: EncUserAddr, auditorPrivateKey: bigint) => bigint;
};
//# sourceMappingURL=encryptions.d.ts.map