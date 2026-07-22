import { Account, type ProviderInterface } from 'starknet';
import { PAYROLL_COMPILED_CLASS_HASH } from './client.js';
import payrollSierra from './payroll-class.json';
import type { Storage } from './storage.js';

// In-browser declare path that bypasses the wallet API entirely. The user
// pastes an account address + private key; we build a starknet.js Account
// directly and call declare(). This avoids the wallet-side rejection seen
// with Ready (Confirm permanently disabled despite valid balance and
// non-duplicate class).
//
// The key lives only in this call's closure — never written to storage, no
// references retained after the function returns. The caller is responsible
// for not echoing the input to logs.
export async function declareWithKey(
  provider: ProviderInterface,
  storage: Storage,
  address: string,
  privateKey: string,
  onStatus: (msg: string) => void,
): Promise<string> {
  onStatus('Connecting…');
  const account = new Account({ provider, address, signer: privateKey });

  onStatus('Submitting declare tx…');
  const res = await account.declare({
    contract: payrollSierra as unknown as Parameters<Account['declare']>[0]['contract'],
    compiledClassHash: PAYROLL_COMPILED_CLASS_HASH,
  });

  onStatus(`Tx submitted: ${res.transaction_hash}\nWaiting for inclusion…`);
  await provider.waitForTransaction(res.transaction_hash);

  onStatus(`Declared.\nClass hash: ${res.class_hash}`);
  await storage.setPayrollClassHash(res.class_hash);
  return res.class_hash;
}
