import { type Account, type ProviderInterface } from 'starknet';
import { createPrivacyClient } from './client.js';
import { SDK_CHAIN_ID } from './network-config.js';
import { createPayrollAccount } from './payroll-account.js';
import { loadOrCreateViewingKey } from './viewing-key.js';
import { onboard, type OnboardPhase, type OnboardResult } from './onboard.js';
import { declarePayrollIfNeeded } from './declare-payroll.js';
import { deployPayrollContract, type DeployFunding } from './deploy-payroll.js';
import { POOL_ADDRESS } from './client.js';
import type { Storage } from './storage.js';
import type { TxSubmitter } from './submitter.js';

// Wallet-connect bootstrap: just load (or generate) the viewing key. The
// PayrollContract and SDK client are built later, inside runOnboarding,
// because the contract address isn't known until the user has either
// onboarded before (persisted) or deployed a fresh instance.
export async function bootstrapViewingKey(
  operatorAccount: Account,
  storage: Storage,
): Promise<bigint> {
  return loadOrCreateViewingKey(storage, operatorAccount.address);
}

// Builds the SDK client (PrivateTransfers) for the deployed PayrollContract.
// Pulled out of runOnboarding so the dashboard can also build it lazily at
// page-load time (so balance reads and deposits work without re-running
// onboarding).
export function buildTransfersClient(
  provider: ProviderInterface,
  payrollAddress: string,
  viewingKey: bigint,
) {
  const payrollAccount = createPayrollAccount(provider, payrollAddress);
  return createPrivacyClient({ account: payrollAccount, viewingKey });
}

// Returns the PayrollContract address for this wallet, deploying a fresh
// instance via UDC if none is persisted yet. The wallet signs the deploy tx;
// the receipt is awaited inside deployPayrollContract (which also probes
// owner() to fail loudly if the deploy didn't end up with the right owner).
export async function ensurePayrollContract(
  operatorAccount: Account,
  classHash: string,
  storage: Storage,
  funding?: DeployFunding,
): Promise<{ address: string; deployedTx?: string }> {
  const cached = await storage.getPayrollAddress(operatorAccount.address);
  if (cached) return { address: cached };

  const { contractAddress, transactionHash } = await deployPayrollContract(operatorAccount, classHash, funding);
  await storage.setPayrollAddress(operatorAccount.address, contractAddress);
  return { address: contractAddress, deployedTx: transactionHash };
}

// Drives the full onboarding flow:
//   - ensure a PayrollContract exists (deploy if first time),
//   - build the privacy-pool SDK client against that contract,
//   - run the sign + proof + submit dance via onboard().
//
// onPhase forwards phase strings to the UI. The deploy step has its own phase
// so the dashboard can show "Deploying contract…" before the wallet pops the
// first signature prompt.
export async function runOnboarding(
  provider: ProviderInterface,
  operatorAccount: Account,
  viewingKey: bigint,
  storage: Storage,
  submitter: TxSubmitter,
  onPhase?: (phase: OnboardPhase | 'declaring_contract' | 'deploying_contract') => void,
): Promise<OnboardResult & { payrollAddress: string; deployedTx?: string; declared: boolean }> {
  // Prepare the AVNU fee_action once so a fresh deploy can batch the fee funding
  // into the deploy tx (one wallet prompt). null for Local / paste-key.
  const prep = (await submitter.prepareFee?.()) ?? null;

  const cached = await storage.getPayrollAddress(operatorAccount.address);
  let deployedTx: string | undefined;
  let payrollAddress: string;
  let declared = false;
  if (cached) {
    payrollAddress = cached;
  } else {
    onPhase?.('declaring_contract');
    const declareResult = await declarePayrollIfNeeded(operatorAccount, storage);
    declared = declareResult.declared;
    onPhase?.('deploying_contract');
    const funding: DeployFunding | undefined = prep
      ? { token: prep.feeAction.token, amount: BigInt(prep.feeAction.amount), poolAddress: POOL_ADDRESS }
      : undefined;
    const deployed = await ensurePayrollContract(operatorAccount, declareResult.classHash, storage, funding);
    payrollAddress = deployed.address;
    deployedTx = deployed.deployedTx;
  }

  const transfers = buildTransfersClient(provider, payrollAddress, viewingKey);

  const result = await onboard({
    operatorAccount,
    payrollAddress,
    transfers,
    submitter,
    chainId: SDK_CHAIN_ID,
    storage,
    prep,
    onPhase,
  });

  return { ...result, payrollAddress, deployedTx, declared };
}
