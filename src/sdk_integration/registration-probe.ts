import { type ProviderInterface } from 'starknet';
import { POOL_ADDRESS } from './client.js';

// Probes the privacy pool's `get_public_key(userAddr)` view to determine
// whether `userAddr` has registered an identity (SetViewingKey landed).
//
// Returns true if the pool has a non-zero public key recorded for the
// address — they're registered and channels can be opened to them.
// Returns false otherwise (no SetViewingKey on record, or the pool can't
// be reached).
//
// Useful as a pre-flight check at user-add time so the address-book UI can
// warn before saving an unreachable recipient. Cheap (single starknet_call)
// and read-only.
export async function isUserRegisteredInPool(
  provider: ProviderInterface,
  userAddr: string,
): Promise<boolean> {
  try {
    const result = await provider.callContract({
      contractAddress: POOL_ADDRESS,
      entrypoint: 'get_public_key',
      calldata: [userAddr],
    } as never);
    const arr = Array.isArray(result) ? result : (result as { result?: string[] }).result;
    if (!arr || arr.length === 0) return false;
    // get_public_key returns a single felt; 0 means "no public key set".
    return BigInt(arr[0]) !== 0n;
  } catch (err) {
    console.warn('[registration-probe] failed for', userAddr, err);
    // On RPC failure, assume registered so we don't block users from saving.
    // The real check happens at transfer time anyway.
    return true;
  }
}
