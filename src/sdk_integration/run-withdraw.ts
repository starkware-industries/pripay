import type { Account } from 'starknet';
import type { PrivateTransfersInterface } from '@starkware-libs/starknet-privacy-sdk';
import { SDK_CHAIN_ID } from './network-config.js';
import { signAndInjectAuth } from './sign-invocation.js';
import { computeInvocationHash } from './tx-hash.js';
import { getProvingBlockId } from './submit.js';
import { injectFeeAction, type TxSubmitter } from './submitter.js';
import { prepareOpFee } from './fee-prep.js';

export type WithdrawPhase =
  | 'building_proof'
  | 'signing_message'
  | 'generating_proof'
  | 'submitting';

export type WithdrawResult = {
  submittedTx: string;
};

// Mirrors runDeposit but unshields rather than shields — no funding step is
// required since the funds are already inside the pool. Authorization is the
// owner wallet's off-chain SNIP-12 signature (verified by the proof's
// is_valid_signature) and the V3 paymaster submission is the same; the SDK
// builder uses `.withdraw` instead of `.deposit`.
export async function runWithdraw(
  operatorAccount: Account,
  payrollAddress: string,
  transfers: PrivateTransfersInterface,
  submitter: TxSubmitter,
  tokenAddress: string,
  recipient: string,
  amount: bigint,
  onPhase?: (phase: WithdrawPhase) => void,
): Promise<WithdrawResult> {
  const phase = onPhase ?? (() => {});

  // AVNU SponsoredPrivate fee_action; fee token picked by shielded balance
  // (STRK → USDC → ETH). null for Local / paste-key submitters.
  const prep = await prepareOpFee(submitter, transfers);

  phase('building_proof');
  // `autoSelectNotes: 'naive'` lets the compiler pull just enough existing
  // pool notes to cover the withdraw amount — without it the inputs are
  // empty and the build throws "Insufficient balance ... need N more".
  // `surplusTo(payrollAddress, false)` routes any leftover (note value above
  // the withdraw amount) back to PayrollContract as a fresh change note,
  // instead of throwing "Surplus … but no surplus action found".
  const invocationResult = await injectFeeAction(
    transfers
      .build({ autoDiscover: { notes: 'refresh' }, autoSetup: true, autoSelectNotes: 'naive' })
      .surplusTo(BigInt(payrollAddress), false)
      .with(tokenAddress, (t) => t.withdraw({ recipient: BigInt(recipient), amount })),
    prep,
  ).createProofInvocation();
  const h = computeInvocationHash(invocationResult.invocation, SDK_CHAIN_ID);

  // Wallet SNIP-12-signs h; the prover verifies it via is_valid_signature.
  phase('signing_message');
  await signAndInjectAuth(operatorAccount, invocationResult.invocation, h);

  phase('generating_proof');
  const provingBlockId = await getProvingBlockId(operatorAccount.provider, 10);
  const result = await transfers.executeWithInvocation(invocationResult, provingBlockId);

  phase('submitting');
  const submittedTx = await submitter.submit(result.callAndProof, prep);

  return { submittedTx };
}
