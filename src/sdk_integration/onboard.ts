import type {
  PrivateTransfersInterface,
} from "@starkware-libs/starknet-privacy-sdk"
import { cairo, type Account, type Call, type constants } from "starknet"
import { computeInvocationHash } from "./tx-hash.js"
import { signAndInjectAuth } from "./sign-invocation.js"
import { getProvingBlockId } from "./submit.js"
import { buildApprovePoolCall } from "./approve-pool.js"
import { POOL_ADDRESS } from "./client.js"
import type { Storage } from "./storage.js"
import { type TxSubmitter, type FeePreparation } from "./submitter.js"

function buildTransferCall(tokenAddress: string, recipient: string, amount: bigint): Call {
  const { low, high } = cairo.uint256(amount)
  return { contractAddress: tokenAddress, entrypoint: "transfer", calldata: [recipient, String(low), String(high)] }
}

function u256(res: string[]): bigint {
  return BigInt(res[0]) + (res.length > 1 ? BigInt(res[1]) << 128n : 0n)
}

// True when PayrollContract already holds >= feeAmt of the fee token AND has
// approved the pool for it — i.e. a fresh deploy already batched the funding, so
// onboarding needn't fund again. Conservative: any read failure → fund.
async function contractCanCoverFee(
  account: Account,
  payroll: string,
  token: string,
  feeAmt: bigint,
): Promise<boolean> {
  try {
    const bal = u256((await account.provider.callContract({
      contractAddress: token, entrypoint: "balance_of", calldata: [payroll],
    })) as string[])
    if (bal < feeAmt) return false
    const allow = u256((await account.provider.callContract({
      contractAddress: token, entrypoint: "allowance", calldata: [payroll, POOL_ADDRESS],
    })) as string[])
    return allow >= feeAmt
  } catch {
    return false
  }
}

export type OnboardOptions = {
  operatorAccount: Account
  payrollAddress: string
  transfers: PrivateTransfersInterface
  submitter: TxSubmitter
  chainId: constants.StarknetChainId
  // Block buffer between head and the proving block (STORED_BLOCK_HASH_BUFFER).
  // 10 matches the sequencer's "proof block too recent" minimum.
  confirmations?: number
  // AVNU fee_action prepared once by the caller (so the deploy step can batch
  // the funding). null/undefined for Local / paste-key submitters.
  prep?: FeePreparation | null
  onPhase?: (phase: OnboardPhase) => void
}

export type OnboardPhase =
  | "building_proof"
  | "signing_message"
  | "generating_proof"
  | "submitting"

export type OnboardResult =
  | { status: "already_onboarded" }
  | { status: "onboarded"; submittedTx: string }

export async function onboard(opts: OnboardOptions): Promise<OnboardResult> {
  const operatorAddr = opts.operatorAccount.address

  if (await opts.storage.isOnboarded(operatorAddr)) {
    return { status: "already_onboarded" }
  }

  const phase = opts.onPhase ?? (() => {})

  // AVNU SponsoredPrivate fee_action, prepared once by the caller.
  const prep = opts.prep ?? null

  phase("building_proof")
  // Registration pays the pool's per-op fee (4 STRK on mainnet) and the pool
  // balance starts empty, so the fee is funded from the wallet and deposited
  // inside this same proof — the fee_action then withdraws it (net-zero). Fresh
  // deploys batch the funding into the deploy tx; here we fund only if the
  // contract isn't already funded+approved. No prep → submitter fronts the fee.
  let builder = opts.transfers.build({ autoSetup: true }).register()
  if (prep) {
    const feeToken = prep.feeAction.token
    const feeAmt = BigInt(prep.feeAction.amount)
    if (!(await contractCanCoverFee(opts.operatorAccount, opts.payrollAddress, feeToken, feeAmt))) {
      const transferCall = buildTransferCall(feeToken, opts.payrollAddress, feeAmt)
      const approveCall = buildApprovePoolCall(opts.payrollAddress, feeToken, POOL_ADDRESS)
      const { transaction_hash } = await opts.operatorAccount.execute([transferCall, approveCall])
      await opts.operatorAccount.provider.waitForTransaction(transaction_hash)
    }
    builder = builder.with(feeToken, (t) =>
      t.deposit({ amount: feeAmt }).withdraw({ recipient: BigInt(prep.feeAction.recipient), amount: feeAmt }),
    )
  }
  const invocationResult = await builder.createProofInvocation()
  const h = computeInvocationHash(invocationResult.invocation, opts.chainId)

  // The wallet SNIP-12-signs h; PayrollContract.is_valid_signature verifies it
  // inside the proof. No on-chain precommit, so we go straight to proving.
  phase("signing_message")
  await signAndInjectAuth(opts.operatorAccount, invocationResult.invocation, h)

  phase("generating_proof")
  const confirmations = opts.confirmations ?? 10
  const provingBlockId = await getProvingBlockId(opts.operatorAccount.provider, confirmations)
  const result = await opts.transfers.executeWithInvocation(invocationResult, provingBlockId)

  phase("submitting")
  const submittedTx = await opts.submitter.submit(result.callAndProof, prep)

  await opts.storage.markOnboarded(operatorAddr)

  return { status: "onboarded", submittedTx }
}
