import { hash, num, type Call } from 'starknet';
import { POOL_ADDRESS, POOL_FEE_TOKEN } from './network-config.js';

// AVNU paymaster (SNIP-29 + PR #67 privacy extensions). The browser hits our
// own /api/paymaster proxy, which injects the x-paymaster-api-key server-side
// and forwards to the managed AVNU endpoint — the key never reaches the client.
//
// We call the JSON-RPC methods directly (paymaster_buildTransaction /
// paymaster_executeTransaction) because starknet.js's PaymasterRpc doesn't model
// the privacy transaction types (apply_action / invoke_and_apply_action). NOTE:
// the deployed managed service uses these names + version "0x1" — NOT the
// buildTypedData/execute names in the repo's main-branch OpenRPC spec (verified
// live 2026-06-04).
const PROXY = '/api/paymaster';

type FeeMode = { mode: 'sponsored_private'; pool_fee_token: string; tip: 'low' | 'normal' | 'high' };

// fee_action: the withdrawal AVNU requires inside the proof to collect the pool
// fee (paid from the user's private balance under SponsoredPrivate).
export type FeeAction = { type: 'withdraw'; recipient: string; token: string; amount: string };

type BuildApplyActionResponse = {
  parameters: unknown; // echoed back verbatim into paymaster_execute
  fee?: unknown;
  fee_action: FeeAction;
};

async function rpc<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) {
    throw new Error(`Paymaster proxy error ${res.status}: ${await res.text().catch(() => '')}`);
  }
  const body = (await res.json()) as { result?: T; error?: { code?: number; message?: string } };
  if (body.error) {
    throw new Error(`AVNU paymaster ${method} failed: ${body.error.message ?? body.error.code ?? 'unknown'}`);
  }
  return body.result as T;
}

function feeMode(poolFeeToken: string): FeeMode {
  return { mode: 'sponsored_private', pool_fee_token: poolFeeToken, tip: 'normal' };
}

// Convert a starknet.js Call to AVNU's {to, selector, calldata} felt shape. The
// SDK hands us `entrypoint` as a selector name; AVNU expects the hashed selector.
function toAvnuCall(call: Call): { to: string; selector: string; calldata: string[] } {
  const raw = (call.calldata ?? []) as Array<string | number | bigint>;
  return {
    to: call.contractAddress,
    selector: hash.getSelectorFromName(call.entrypoint),
    calldata: raw.map((c) => num.toHex(c)),
  };
}

// Step 1 of SponsoredPrivate: ask AVNU what fee_action to bake into the proof.
// Pure proof submissions (transfer/withdraw/swap/deposit-proof/onboard) carry no
// user invoke, so the type is `apply_action` and the response has no typed_data.
export async function buildApplyActionFee(
  poolFeeToken: string = POOL_FEE_TOKEN,
): Promise<BuildApplyActionResponse> {
  return rpc<BuildApplyActionResponse>('paymaster_buildTransaction', {
    transaction: { type: 'apply_action', apply_action: { pool_address: POOL_ADDRESS } },
    parameters: { version: '0x1', fee_mode: feeMode(poolFeeToken) },
  });
}

// Step 3 of SponsoredPrivate: hand AVNU the completed proof. callAndProof.call is
// already the pool's apply_actions call; the forwarder submits it via
// execute_private_sponsored and pays gas from our prepaid credits.
export async function executeApplyAction(args: {
  applyActionsCall: Call;
  proof: string;
  proofFacts: string[];
  parameters: unknown; // the object echoed from buildApplyActionFee
}): Promise<string> {
  const result = await rpc<{ transaction_hash?: string; transactionHash?: string; tracking_id?: string }>(
    'paymaster_executeTransaction',
    {
      transaction: {
        type: 'apply_action',
        apply_action: {
          apply_actions_call: toAvnuCall(args.applyActionsCall),
          proof: args.proof,
          proof_facts: args.proofFacts,
        },
      },
      parameters: args.parameters,
    },
  );
  // Prefer the on-chain hash; fall back to tracking_id (resolvable via
  // paymaster_trackingIdToLatestHash) so the caller always gets an identifier.
  const txHash = result.transaction_hash ?? result.transactionHash ?? result.tracking_id;
  if (!txHash) throw new Error('AVNU paymaster_executeTransaction returned no transaction hash or tracking id');
  return txHash;
}

// Health probe, run once a wallet session exists. Returns false (rather than
// throwing) so a paymaster outage degrades to the paste-key fallback instead of
// bricking the app — but the reason is logged rather than swallowed. Silence here
// cost real debugging time: the proxy requires a SIWS session, so a 401 means the
// probe ran before login, which is a very different problem from "paymaster is down"
// or "AVNU_PAYMASTER_API_KEY is unset" (that one surfaces as 503).
export async function paymasterAvailable(): Promise<boolean> {
  try {
    return await rpc<boolean>('paymaster_isAvailable', {});
  } catch (e) {
    console.warn('[paymaster] availability probe failed — staying on the paste-key submitter:',
      e instanceof Error ? e.message : e);
    return false;
  }
}
