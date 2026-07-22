import {
  SetupRequirement,
  type PrivateTransfersInterface,
  type StarknetAddress,
} from "@starkware-libs/starknet-privacy-sdk"

// Asserts that the sender (the account backing `transfers`) can privately
// transfer `token` to `recipient`. Read-only — does not open anything.
//
// Throws with an actionable message when:
//   - the sender isn't registered in the pool,
//   - the base channel between sender and recipient is missing, or
//   - the token-subchannel for `token` inside that channel is missing.
//
// Returns silently when the pair is already Ready. Use this as a guard
// before calling transferToOne/multipay; perform the actual openChannel /
// openTokenChannel calls yourself, with whatever pacing the prover needs
// between them.
export async function ensureChannelReady(
  transfers: PrivateTransfersInterface,
  recipient: StarknetAddress,
  token: StarknetAddress,
): Promise<void> {
  const requirement = await transfers.discoverRequirement(recipient, token)

  switch (requirement) {
    case SetupRequirement.Register:
      throw new Error(
        `Channel not ready: sender ${transfers.user} is not registered in the privacy pool.`,
      )
    case SetupRequirement.SetupChannel:
      throw new Error(
        `Channel not ready: no base channel exists between ${transfers.user} and ${recipient}. Call openChannel first.`,
      )
    case SetupRequirement.SetupToken:
      throw new Error(
        `Channel not ready: no token-subchannel for token ${token} between ${transfers.user} and ${recipient}. Call openTokenChannel first.`,
      )
    case SetupRequirement.Ready:
      return
  }
}
