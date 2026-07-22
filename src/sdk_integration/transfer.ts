import {
  AddressMap,
  SetupRequirement,
  type ExecuteResult,
  type PrivateTransfersInterface,
  type StarknetAddress,
} from "@starkware-libs/starknet-privacy-sdk"
import type { BlockIdentifier } from "starknet"

export type Payment = {
  recipient: StarknetAddress
  token: StarknetAddress
  amount: bigint
}

export type TransferOptions = {
  // Block to prove against. The sequencer requires this to be at least
  // 10 blocks behind the submission block; otherwise the chain rejects with
  // "proof block number is too recent". Pass `latestBlock - 10` (or earlier).
  provingBlockId?: BlockIdentifier
}

export async function transferToOne(
  transfers: PrivateTransfersInterface,
  payment: Payment,
  options?: TransferOptions,
): Promise<ExecuteResult> {
  return multipay(transfers, [payment], options)
}

export async function multipay(
  transfers: PrivateTransfersInterface,
  payments: Payment[],
  options?: TransferOptions,
): Promise<ExecuteResult> {
  if (payments.length === 0) {
    throw new Error("multipay: payments list is empty.")
  }

  // Preflight each (recipient, token) pair: only `Ready` means the channel and
  // token-subchannel both exist. Anything else means the caller skipped a
  // setup step and the SDK would throw a less actionable error later.
  const requirements = await Promise.all(
    payments.map((p) => transfers.discoverRequirement(p.recipient, p.token)),
  )
  for (let i = 0; i < payments.length; i++) {
    const { recipient, token } = payments[i]
    switch (requirements[i]) {
      case SetupRequirement.Register:
        throw new Error(
          `Cannot transfer: sender ${transfers.user} is not registered in the privacy pool.`,
        )
      case SetupRequirement.SetupChannel:
        throw new Error(
          `Cannot transfer to ${recipient}: no channel exists. Call openChannel first.`,
        )
      case SetupRequirement.SetupToken:
        throw new Error(
          `Cannot transfer token ${token} to ${recipient}: no token-subchannel exists. Call openTokenChannel first.`,
        )
    }
  }

  const byToken = new AddressMap<Payment[]>()
  for (const p of payments) {
    const list = byToken.get(p.token) ?? []
    list.push(p)
    byToken.set(p.token, list)
  }

  let builder = transfers.build({
    autoSelectNotes: "naive",
    autoDiscover: { notes: "refresh", channels: "refresh" },
    provingBlockId: options?.provingBlockId,
  })

  for (const [token, group] of byToken.entries()) {
    builder = builder.with(token, (t) =>
      t.transfer(...group.map(({ recipient, amount }) => ({ recipient, amount }))),
    )
  }

  return builder.surplusTo(transfers.user).execute()
}
