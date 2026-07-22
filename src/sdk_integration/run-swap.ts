import type { Account } from 'starknet';
import { Open, type PrivateTransfersInterface } from '@starkware-libs/starknet-privacy-sdk';
import { SDK_CHAIN_ID, EKUBO_ROUTER_ADDRESS } from './network-config.js';
import { signAndInjectAuth } from './sign-invocation.js';
import { computeInvocationHash } from './tx-hash.js';
import { getProvingBlockId } from './submit.js';
import { resolveEkuboPool } from './ekubo-pools.js';
import { injectFeeAction, type TxSubmitter } from './submitter.js';
import { prepareOpFee } from './fee-prep.js';

export type SwapPhase =
  | 'building_proof'
  | 'signing_message'
  | 'generating_proof'
  | 'submitting';

export type SwapResult = {
  submittedTx: string;
};

// In-pool conversion of `fromToken` to `toToken`. The pool can't swap by
// itself — it withdraws fromToken to the executor contract, opens a note for
// the result in toToken, and invokes the executor with (fromToken, toToken,
// amount, openNoteId). The executor (privacy-pool team's swap-anonymizer)
// fills that open note with the swapped tokens. Mirrors the simple-private-
// transfers `swap` shape but routes through createProofInvocation so the
// SNIP-12 authorization + paymaster submission stay the same as Shield /
// Unshield.
export async function runSwap(
  operatorAccount: Account,
  payrollAddress: string,
  transfers: PrivateTransfersInterface,
  submitter: TxSubmitter,
  fromTokenAddress: string,
  fromAmount: bigint,
  toTokenAddress: string,
  executorAddress: string,
  onPhase?: (phase: SwapPhase) => void,
): Promise<SwapResult> {
  const phase = onPhase ?? (() => {});

  if (!EKUBO_ROUTER_ADDRESS) {
    throw new Error(
      'Ekubo router not configured for this network. Set ekuboRouterAddress in network-config.ts.',
    );
  }
  const ekuboRouter = BigInt(EKUBO_ROUTER_ADDRESS);
  // Resolve pool params upfront so a misconfigured pair fails before we
  // burn proof-generation time.
  const pool = resolveEkuboPool(fromTokenAddress, toTokenAddress);

  const executor = BigInt(executorAddress);
  const userAddress = BigInt(payrollAddress);

  // AVNU SponsoredPrivate fee_action; fee token picked by shielded balance
  // (STRK → USDC → ETH). injectFeeAction appends the fee withdrawal AFTER
  // .invoke() below, so the swap's own withdrawal stays withdrawals[0] for the
  // executor calldata. null for Local / paste-key submitters.
  const prep = await prepareOpFee(submitter, transfers);

  phase('building_proof');
  const invocationResult = await injectFeeAction(
    transfers
      .build({ autoDiscover: { notes: 'refresh' }, autoSetup: true, autoSelectNotes: 'naive' })
      .with(fromTokenAddress, (t) => t.withdraw({ recipient: executor, amount: fromAmount }))
      .surplusTo(userAddress, false)
      .with(toTokenAddress, (t) => t.transfer({ recipient: userAddress, amount: Open, depositor: executor }))
      .invoke(({ openNotes, withdrawals }) => ({
        contractAddress: '0x' + executor.toString(16),
        // Ekubo executor calldata (see SDK README "Anonymous swap (Ekubo)").
        // i129 sign is hard-coded to 0n — we always specify exact-input.
        // minimum_received low/high are 0n; for production, replace with a
        // slippage-derived minimum before calling.
        calldata: [
          ekuboRouter,
          withdrawals[0].token,
          withdrawals[0].amount,
          0n,
          pool.token0,
          pool.token1,
          pool.fee,
          pool.tickSpacing,
          pool.extension,
          0n,
          0n,
          pool.skipAhead,
          openNotes[0].noteId,
        ],
      })),
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
