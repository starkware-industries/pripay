import type { Account } from 'starknet';
import { PAYROLL_CLASS_HASH, PAYROLL_COMPILED_CLASS_HASH } from './client.js';
import payrollSierra from './payroll-class.json';
import type { Storage } from './storage.js';

// The wallet re-serializes the contract ABI on declare, changing its keccak vs. what
// starknet.js pre-computes — so we can't hardcode the class hash reliably. Instead,
// cache what the declare receipt returns and reuse it on subsequent runs.
export async function declarePayrollIfNeeded(
  operatorAccount: Account,
  storage: Storage,
): Promise<{ classHash: string; declared: boolean }> {
  const cached = await storage.getPayrollClassHash();
  if (cached) {
    try {
      await operatorAccount.provider.getClass(cached);
      return { classHash: cached, declared: false };
    } catch { }
  }

  try {
    await operatorAccount.provider.getClass(PAYROLL_CLASS_HASH);
    await storage.setPayrollClassHash(PAYROLL_CLASS_HASH);
    return { classHash: PAYROLL_CLASS_HASH, declared: false };
  } catch { }

  const res = await operatorAccount.declare({
    contract: payrollSierra as unknown as Parameters<Account['declare']>[0]['contract'],
    compiledClassHash: PAYROLL_COMPILED_CLASS_HASH,
  });
  await operatorAccount.provider.waitForTransaction(res.transaction_hash);

  await storage.setPayrollClassHash(res.class_hash);
  return { classHash: res.class_hash, declared: true };
}
