import type { Account } from 'starknet';
import { PAYROLL_CLASS_HASH, PAYROLL_COMPILED_CLASS_HASH } from './client.js';
import { ALLOWED_PAYROLL_CLASS_HASHES } from './network-config.js';
import payrollSierra from './payroll-class.json';
import type { Storage } from './storage.js';

// Compare as felts so padding / casing differences don't matter.
function isAllowedClassHash(candidate: string): boolean {
  let v: bigint;
  try { v = BigInt(candidate); } catch { return false; }
  return ALLOWED_PAYROLL_CLASS_HASHES.some((allowed) => {
    try { return BigInt(allowed) === v; } catch { return false; }
  });
}

// The wallet re-serializes the contract ABI on declare, changing its keccak vs. what
// starknet.js pre-computes — so we can't hardcode the class hash reliably. Instead,
// cache what the declare receipt returns and reuse it on subsequent runs.
export async function declarePayrollIfNeeded(
  operatorAccount: Account,
  storage: Storage,
): Promise<{ classHash: string; declared: boolean }> {
  // The cache lives under a shared, server-side key, so treat it as untrusted input.
  // getClass() only proves a class EXISTS — it says nothing about whose code it is,
  // and an attacker can declare their own class to satisfy it. A poisoned entry would
  // otherwise be deployed here and funded by the operator's own wallet, so the hash
  // must be one we pinned. An unrecognised entry is ignored, not fatal: we fall
  // through to the pinned constant below.
  const cached = await storage.getPayrollClassHash();
  if (cached && isAllowedClassHash(cached)) {
    try {
      await operatorAccount.provider.getClass(cached);
      return { classHash: cached, declared: false };
    } catch { }
  } else if (cached) {
    console.warn('[declare] ignoring cached payroll class hash outside the allowlist:', cached);
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
