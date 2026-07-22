import type { Storage } from "./storage.js"

// Viewing keys are 200-bit secrets that the privacy pool uses to:
//   - derive note discovery locations (read incoming notes),
//   - prove ownership when spending notes,
//   - selectively disclose to an auditing entity (compliance).
//
// Pool-side ceiling: MAX_VIEWING_KEY = 2^200 (interfaces.d.ts:9). We sample 25
// random bytes (200 bits) so the value fits without modular reduction.
//
// Once registered on-chain (SetViewingKey action), the viewing key is
// immutable per identity. Lose it → lose access to all notes ever sent.
function generate200BitViewingKey(): bigint {
  const bytes = new Uint8Array(25)
  crypto.getRandomValues(bytes)
  let hex = ""
  for (const b of bytes) hex += b.toString(16).padStart(2, "0")
  return BigInt("0x" + hex)
}

// Returns the stored key for `walletAddr` or, if absent, generates a fresh one
// and persists it. Keyed on the wallet that owns PayrollContract.
//
// The returned key is the same value across calls for a given wallet — only
// regenerates when the storage shows no prior key. This matters: re-running
// onboarding with a fresh key would orphan all previously-deposited notes.
export async function loadOrCreateViewingKey(
  storage: Storage,
  walletAddr: string,
): Promise<bigint> {
  const existing = await storage.getViewingKey(walletAddr)
  if (existing !== null) return existing
  const fresh = generate200BitViewingKey()
  await storage.setViewingKey(walletAddr, fresh)
  return fresh
}
