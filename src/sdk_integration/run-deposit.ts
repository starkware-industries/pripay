import { cairo, type Account, type Call } from 'starknet';
import type { PrivateTransfersInterface } from '@starkware-libs/starknet-privacy-sdk';
import { POOL_ADDRESS } from './client.js';
import { SDK_CHAIN_ID } from './network-config.js';
import { buildApprovePoolCall } from './approve-pool.js';
import { signAndInjectAuth } from './sign-invocation.js';
import { computeInvocationHash } from './tx-hash.js';
import { getProvingBlockId } from './submit.js';
import { injectFeeAction, type TxSubmitter } from './submitter.js';

export type DepositPhase =
  | 'funding_contract'
  | 'building_proof'
  | 'signing_message'
  | 'generating_proof'
  | 'submitting';

export type DepositResult = {
  fundingTx: string;
  submittedTx: string;
};

function buildTransferCall(tokenAddress: string, recipient: string, amount: bigint): Call {
  const { low, high } = cairo.uint256(amount);
  return {
    contractAddress: tokenAddress,
    entrypoint: 'transfer',
    calldata: [recipient, String(low), String(high)],
  };
}

export async function runDeposit(
  operatorAccount: Account,
  payrollAddress: string,
  transfers: PrivateTransfersInterface,
  submitter: TxSubmitter,
  tokenAddress: string,
  amount: bigint,
  onPhase?: (phase: DepositPhase) => void,
): Promise<DepositResult> {
  const phase = onPhase ?? (() => {});

  // AVNU SponsoredPrivate: pay the pool fee in the DEPOSITED token, funded from
  // the wallet alongside the deposit — so a first deposit works with no prior
  // shielded balance. null for Local / paste-key submitters.
  const prep = (await submitter.prepareFee?.(tokenAddress)) ?? null;
  const feeAmt = prep ? BigInt(prep.feeAction.amount) : 0n;
  const fundAmount = amount + feeAmt;

  phase('funding_contract');
  const transferCall = buildTransferCall(tokenAddress, payrollAddress, fundAmount);
  const approveCall = buildApprovePoolCall(payrollAddress, tokenAddress, POOL_ADDRESS);
  const { transaction_hash: fundingTx } = await operatorAccount.execute([transferCall, approveCall]);
  await operatorAccount.provider.waitForTransaction(fundingTx);

  // autoSetup adds OpenChannel/OpenTokenChannel for first-time token deposits.
  // Deposit amount+fee, then injectFeeAction withdraws the fee back out (same
  // token bucket merges), netting `amount` shielded.
  phase('building_proof');
  const invocationResult = await injectFeeAction(
    transfers
      .build({ autoDiscover: { notes: 'refresh' }, autoSetup: true })
      .with(tokenAddress, (t) => t.deposit({ amount: fundAmount })),
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

  return { fundingTx, submittedTx };
}
