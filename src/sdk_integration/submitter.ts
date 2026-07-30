import type { CallAndProof, PrivateTransfersBuilder } from "@starkware-libs/starknet-privacy-sdk"
import { buildApplyActionFee, executeApplyAction, type FeeAction } from "./avnu-paymaster.js"

// Result of the optional pre-proof fee step (AVNU SponsoredPrivate). The
// `feeAction` withdrawal must be baked into the proof before it's generated;
// `parameters` is AVNU's opaque echo, handed back verbatim to submit().
export type FeePreparation = {
  feeAction: FeeAction
  // Pool fee shown to the user, in the pool-fee token's smallest unit (fri for STRK).
  feeFri: bigint | null
  parameters: unknown
}

// PayrollContract isn't a real account class, so neither the wallet nor PayrollContract
// can submit the outer V3 invoke. A paymaster (separate Starknet account that pays fees)
// is the production submission path; LocalSubmitter is a stub for dev/testing.
export interface TxSubmitter {
  // Optional step run BEFORE proof generation. Returns the fee_action withdrawal
  // to inject into the proof plus an opaque context for submit(). poolFeeToken
  // overrides the default fee token (the pool fee is paid in it, oracle-converted).
  // Submitters that pay fees out-of-band (Local, paste-key) omit it.
  prepareFee?(poolFeeToken?: string): Promise<FeePreparation | null>
  submit(callAndProof: CallAndProof, prep?: FeePreparation | null): Promise<string>
  // Fee in fri (= 1e-18 STRK). Returns null when the submitter can't estimate.
  estimateFee(callAndProof: CallAndProof): Promise<bigint | null>
}

// Bake AVNU's fee_action into the proof builder as a withdrawal to the
// forwarder. No-op when there's no prep (Local / paste-key paths), so the
// run-*.ts pipelines stay identical regardless of submitter. NOTE: if the
// pool-fee token coincides with a token already in the build, the SDK folds
// both into one token bucket — verify the resulting amounts on the smoke test.
export function injectFeeAction(
  builder: PrivateTransfersBuilder,
  prep: FeePreparation | null,
): PrivateTransfersBuilder {
  if (!prep) return builder
  return builder.with(prep.feeAction.token, (t) =>
    t.withdraw({ recipient: BigInt(prep.feeAction.recipient), amount: BigInt(prep.feeAction.amount) }),
  )
}

export class LocalSubmitter implements TxSubmitter {
  private counter = 0

  async submit(callAndProof: CallAndProof): Promise<string> {
    this.counter += 1
    const fakeHash = "0x" + this.counter.toString(16).padStart(64, "0")
    console.info("[LocalSubmitter] simulated submit", {
      fakeHash,
      call: callAndProof.call,
      proofFactsLen: callAndProof.proof.proofFacts.length,
      proofBytes: callAndProof.proof.data.length,
    })
    return fakeHash
  }

  async estimateFee(_callAndProof: CallAndProof): Promise<bigint | null> {
    return null
  }
}

// wallet_addInvokeTransaction doesn't accept proofFacts, so the wallet can't
// build the right envelope. A direct starknet.js Account can.
import { cairo, type Account } from "starknet"
import { POOL_ADDRESS } from "./network-config.js"

// 2x headroom: starknet.js applies ~1.5x when setting V3 resource-bound ceilings;
// we use 2x so the pre-flight balance check catches the same cases the chain rejects.
const FEE_HEADROOM = 2n

// The mainnet pool charges a per-apply_actions fee, pulled from the submitter
// (this paymaster) via transferFrom — so the paymaster must approve the pool.
// We top up in batches rather than per-submit, and keep the approval bounded
// (not unlimited) to cap exposure. Sepolia's pool has no fee, so this is a
// no-op there.
const FEE_APPROVAL_BATCH = 50n

function friToStrk(fri: bigint): string {
  const whole = fri / 10n ** 18n
  const frac = (fri % 10n ** 18n) / 10n ** 15n  // 3 decimal places
  return `${whole}.${String(frac).padStart(3, '0')} STRK`
}

function u256FromResult(result: string[]): bigint {
  const low = BigInt(result[0])
  const high = result.length > 1 ? BigInt(result[1]) : 0n
  return low + (high << 128n)
}

export class PrivateKeyPaymasterSubmitter implements TxSubmitter {
  constructor(private account: Account, private strkAddress: string) {}

  get address(): string {
    return this.account.address
  }

  // Ensure the paymaster has approved the pool to pull the per-op fee in STRK.
  // Reads the pool's live fee; if the current allowance can't cover it, sends
  // a bounded approve and waits for inclusion. No-op when the pool has no fee
  // entrypoint or the fee is zero (e.g. Sepolia).
  private async ensureFeeAllowance(): Promise<void> {
    let feeAmount: bigint
    try {
      const res = await this.account.provider.callContract({
        contractAddress: POOL_ADDRESS,
        entrypoint: 'get_fee_amount',
        calldata: [],
      })
      feeAmount = u256FromResult(res as string[])
    } catch {
      return  // pool has no fee entrypoint (older/Sepolia pool) — nothing to do
    }
    if (feeAmount === 0n) return

    // The pool pulls this fee from the paymaster via transferFrom — without the
    // balance, apply_actions (and its simulation in estimateFee) reverts with a
    // bare "Insufficient ERC20 balance". Catch it here with a readable message.
    const balanceRes = await this.account.provider.callContract({
      contractAddress: this.strkAddress,
      entrypoint: 'balance_of',
      calldata: [this.account.address],
    })
    const strkBalance = u256FromResult(balanceRes as string[])
    if (strkBalance < feeAmount) {
      throw new Error(
        `Paymaster account can't cover the pool's per-transaction fee.\n` +
        `Pool fee: ${friToStrk(feeAmount)}\n` +
        `Paymaster: ${this.account.address}\n` +
        `Current STRK balance: ~${friToStrk(strkBalance)}\n` +
        `Top up the paymaster with STRK and retry.`,
      )
    }

    const allowanceRes = await this.account.provider.callContract({
      contractAddress: this.strkAddress,
      entrypoint: 'allowance',
      calldata: [this.account.address, POOL_ADDRESS],
    })
    const allowance = u256FromResult(allowanceRes as string[])
    if (allowance >= feeAmount) return

    const target = feeAmount * FEE_APPROVAL_BATCH
    const { low, high } = cairo.uint256(target)
    const approveTx = await this.account.execute({
      contractAddress: this.strkAddress,
      entrypoint: 'approve',
      calldata: [POOL_ADDRESS, String(low), String(high)],
    })
    await this.account.provider.waitForTransaction(approveTx.transaction_hash)
    console.info('[PrivateKeyPaymaster] approved pool fee allowance', friToStrk(target))
  }

  async submit(callAndProof: CallAndProof): Promise<string> {
    // Must run before any fee estimation — the pool's apply_actions reverts
    // (and so does estimateInvokeFee, which simulates it) without the allowance.
    await this.ensureFeeAllowance()

    const estimatedFee = await this.estimateFee(callAndProof)
    if (estimatedFee !== null) {
      const [low, high] = await this.account.provider.callContract({
        contractAddress: this.strkAddress,
        entrypoint: 'balance_of',
        calldata: [this.account.address],
      })
      const balance = BigInt(low) + (BigInt(high) << 128n)
      const required = estimatedFee * FEE_HEADROOM
      if (balance < required) {
        throw new Error(
          `Paymaster account has insufficient STRK to cover transaction fees.\n` +
          `Paymaster: ${this.account.address}\n` +
          `Current balance: ~${friToStrk(balance)}\n` +
          `Estimated minimum needed: ~${friToStrk(required)}\n` +
          `Please top up the paymaster account and retry.`,
        )
      }
    }

    const tx = await this.account.execute(callAndProof.call, {
      proofFacts: callAndProof.proof.proofFacts,
      proof: callAndProof.proof.data,
    } as never)
    console.info('[PrivateKeyPaymaster] submitted', tx.transaction_hash)
    return tx.transaction_hash
  }

  async estimateFee(callAndProof: CallAndProof): Promise<bigint | null> {
    try {
      const est = await this.account.estimateInvokeFee(callAndProof.call, {
        proofFacts: callAndProof.proof.proofFacts,
        proof: callAndProof.proof.data,
      } as never)
      return BigInt(est.overall_fee)
    } catch (err) {
      console.warn('[PrivateKeyPaymaster] estimateFee failed', err)
      return null
    }
  }
}

// Production submitter: the AVNU paymaster (SponsoredPrivate). No client-side
// key — AVNU's forwarder submits and sponsors gas from our prepaid credits; the
// user pays the pool fee via the fee_action withdrawal baked into the proof.
// Two-phase: prepareFee() before proof build, submit() after.
// Felt-equality that skips the check (returns true) if either side can't parse,
// so a malformed value degrades to "no guard" rather than a false rejection.
function sameFelt(a: string, b: string): boolean {
  try { return BigInt(a) === BigInt(b) } catch { return true }
}

export class AvnuPaymasterSubmitter implements TxSubmitter {
  // expectedForwarder (network-config PAYMASTER_FORWARDER) is AVNU's known
  // forwarder for our pool; we assert AVNU's returned fee_action.recipient
  // matches it, which catches a wrong/un-whitelisted pool early.
  constructor(private poolFeeToken: string, private expectedForwarder?: string) {}

  async prepareFee(poolFeeToken: string = this.poolFeeToken): Promise<FeePreparation> {
    const built = await buildApplyActionFee(poolFeeToken)
    if (this.expectedForwarder && !sameFelt(built.fee_action.recipient, this.expectedForwarder)) {
      throw new Error(
        `AVNU fee_action recipient ${built.fee_action.recipient} ≠ configured forwarder ` +
        `${this.expectedForwarder}. Wrong pool or misconfigured paymaster — refusing to submit.`,
      )
    }
    let feeFri: bigint | null = null
    try { feeFri = BigInt(built.fee_action.amount) } catch { feeFri = null }
    return { feeAction: built.fee_action, feeFri, parameters: built.parameters }
  }

  async submit(callAndProof: CallAndProof, prep?: FeePreparation | null): Promise<string> {
    if (!prep) {
      throw new Error('AVNU paymaster needs a prepared fee_action — call prepareFee() before submit().')
    }
    const tx = await executeApplyAction({
      applyActionsCall: callAndProof.call,
      proof: callAndProof.proof.data,
      proofFacts: callAndProof.proof.proofFacts,
      parameters: prep.parameters,
    })
    console.info('[AvnuPaymaster] submitted', tx)
    return tx
  }

  // Gas is sponsored, so there's nothing to estimate here; the user-facing pool
  // fee comes from prepareFee().feeFri and is shown at confirm time.
  async estimateFee(_callAndProof: CallAndProof): Promise<bigint | null> {
    return null
  }
}
