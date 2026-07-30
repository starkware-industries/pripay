import {
  SetupRequirement,
  type ExecuteResult,
  type PrivateTransfersInterface,
  type StarknetAddress,
} from "@starkware-libs/starknet-privacy-sdk"
import type { BlockIdentifier } from "starknet"

export type OpenChannelOptions = {
  // Block to prove against. The sequencer requires this to be at least
  // 10 blocks behind the submission block; otherwise the chain rejects with
  // "proof block number is too recent". Pass `latestBlock - 10` (or earlier).
  provingBlockId?: BlockIdentifier
}

// Opens a private-pool channel between the sender (the account backing
// `transfers`) and `recipient`. A channel is a one-time prerequisite for
// sending private transfers to that recipient.
//
// Throws if the sender isn't registered in the pool, or if a channel already
// exists between this pair.
//
// Submit the returned call/proof via `account.execute(result.callAndProof.call,
// { proofFacts: result.callAndProof.proof.proofFacts, proof: result.callAndProof.proof.data })`,
// same as transfer.ts.
export async function openChannel(
  transfers: PrivateTransfersInterface,
  recipient: StarknetAddress,
  options?: OpenChannelOptions,
): Promise<ExecuteResult> {
  // discoverRequirement needs a token but we only care about channel-level
  // state, so we pass `recipient` as a sentinel — SetupToken and Ready both
  // indicate the base channel already exists.
  const requirement = await transfers.discoverRequirement(recipient, recipient)
  if (requirement === SetupRequirement.Register) {
    throw new Error(
      `Cannot open channel: sender ${transfers.user} is not registered in the privacy pool.`,
    )
  }
  if (
    requirement === SetupRequirement.SetupToken ||
    requirement === SetupRequirement.Ready
  ) {
    throw new Error(
      `Cannot open channel: a channel already exists between ${transfers.user} and ${recipient}.`,
    )
  }

  return transfers
    .build({
      autoDiscover: { channels: "refresh" },
      provingBlockId: options?.provingBlockId,
    })
    .setup(recipient)
    .execute()
}

// Opens a token-subchannel for `token` inside the existing channel between
// the sender and `recipient`. A token-subchannel is required before that
// specific token can flow privately between the pair.
//
// Throws if the base channel doesn't exist yet — call `openChannel` first.
// Also throws if the user isn't registered.
export async function openTokenChannel(
  transfers: PrivateTransfersInterface,
  recipient: StarknetAddress,
  token: StarknetAddress,
  options?: OpenChannelOptions,
): Promise<ExecuteResult> {
  const requirement = await transfers.discoverRequirement(recipient, token)
  if (requirement === SetupRequirement.Register) {
    throw new Error(
      `Cannot open token-subchannel: sender ${transfers.user} is not registered in the privacy pool.`,
    )
  }
  if (requirement === SetupRequirement.SetupChannel) {
    throw new Error(
      `Cannot open token-subchannel: no base channel exists between ${transfers.user} and ${recipient}. Call openChannel first.`,
    )
  }

  return transfers
    .build({
      autoDiscover: { channels: "refresh" },
      provingBlockId: options?.provingBlockId,
    })
    .with(token, (t) => t.setup(recipient))
    .execute()
}
