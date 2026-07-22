import { type Account } from 'starknet';
import type { PrivateTransfersInterface } from '@starkware-libs/starknet-privacy-sdk';
import { signAndInjectAuth } from './sign-invocation.js';
import { computeInvocationHash } from './tx-hash.js';
import { getProvingBlockId } from './submit.js';
import { SDK_CHAIN_ID } from './network-config.js';
import { injectFeeAction, type TxSubmitter } from './submitter.js';
import { prepareOpFee } from './fee-prep.js';

export type TransferPhase =
  | 'building_proof'
  | 'signing_message'
  | 'generating_proof'
  | 'awaiting_confirmation'
  | 'submitting';

export type TransferResult = {
  submittedTx: string;
  /** Paymaster fee estimate in fri (= 10^-18 STRK). null if estimation failed. */
  paymasterFeeFri: bigint | null;
};

// Distinguishable error so the UI can suppress its red banner and show a
// neutral "cancelled" status instead of treating user-decline as a failure.
export class TransferCancelledError extends Error {
  constructor() {
    super('Transfer cancelled at fee-confirmation step.');
    this.name = 'TransferCancelledError';
  }
}

export async function runTransferToOne(
  operatorAccount: Account,
  payrollAddress: string,
  transfers: PrivateTransfersInterface,
  submitter: TxSubmitter,
  recipient: string,
  tokenAddress: string,
  amount: bigint,
  onPhase?: (phase: TransferPhase) => void,
  // Called after the proof exists but before submission. Receives the real
  // paymaster fee estimate (fri, or null when the submitter can't estimate).
  // Resolve true → submit; false → abort with TransferCancelledError.
  onConfirm?: (estimatedFeeFri: bigint | null) => Promise<boolean>,
): Promise<TransferResult> {
  const phase = onPhase ?? (() => {});

  // AVNU SponsoredPrivate: pick the fee token by shielded balance (STRK →
  // USDC → ETH) and fetch the fee_action so it can be baked into the proof.
  // null for Local / paste-key submitters (injectFeeAction no-ops).
  const prep = await prepareOpFee(submitter, transfers);

  phase('building_proof');
  let invocationResult;
  try {
    invocationResult = await injectFeeAction(
      transfers
        .build({
          autoDiscover: { notes: 'refresh', channels: 'refresh' },
          autoSelectNotes: 'naive',
          autoSetup: true,
        })
        .with(tokenAddress, (t) => t.transfer({ recipient, amount }))
        // autoSelectNotes:'naive' may over-spend; surplus returns to PayrollContract.
        .surplusTo(transfers.user),
      prep,
    ).createProofInvocation();
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    if (msg.includes('Missing channel context')) {
      throw new Error(
        `Recipient ${recipient.slice(0, 10)}…${recipient.slice(-4)} hasn't onboarded the privacy pool yet. ` +
        `They need to deploy + SetViewingKey their own identity in the pool before you can transfer to them.`,
      );
    }
    throw err;
  }
  const h = computeInvocationHash(invocationResult.invocation, SDK_CHAIN_ID);

  // Wallet SNIP-12-signs h; the prover verifies it via is_valid_signature.
  phase('signing_message');
  await signAndInjectAuth(operatorAccount, invocationResult.invocation, h);

  phase('generating_proof');
  const provingBlockId = await getProvingBlockId(operatorAccount.provider, 10);
  const result = await transfers.executeWithInvocation(invocationResult, provingBlockId);

  phase('awaiting_confirmation');
  // Under AVNU, gas is sponsored; the fee the user pays is the pool fee, known
  // from prepareFee(). Fall back to the submitter's estimate otherwise.
  const paymasterFeeFri = prep ? prep.feeFri : await submitter.estimateFee(result.callAndProof);
  if (onConfirm) {
    const proceed = await onConfirm(paymasterFeeFri);
    if (!proceed) throw new TransferCancelledError();
  }

  phase('submitting');
  const submittedTx = await submitter.submit(result.callAndProof, prep);

  return { submittedTx, paymasterFeeFri };
}
