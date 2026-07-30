import type { Storage } from './storage.js';

// HTTP-backed Storage that survives reloads. Keys are namespaced under the
// wallet address so multiple owners can coexist on the same server (multiple
// operators sharing one deployment).
//
// Backed by the existing server.js `/api/:key` endpoints (JSON file). Reads
// at most once per call and tolerates the server being offline by returning
// null / no-op — the orchestrator's idempotency keeps things sane.
const API = '/api';

function vkKey(addr: string): string {
  return `pripay:vk:${addr.toLowerCase()}`;
}
function obKey(addr: string): string {
  return `pripay:onboarded:${addr.toLowerCase()}`;
}
function paKey(addr: string): string {
  return `pripay:payroll:${addr.toLowerCase()}`;
}
const CLASS_HASH_KEY = 'pripay:payroll_class_hash';

// Values are wrapped in `{ v: ... }` because Express's strict JSON body
// parser rejects bare strings / booleans at the top level. Round-trip is
// transparent: the wrapper is opened in getJson.
async function getJson<T>(key: string): Promise<T | null> {
  try {
    const res = await fetch(`${API}/${encodeURIComponent(key)}`);
    if (!res.ok) return null;
    const wrapped = (await res.json()) as { v: T } | T | null;
    if (wrapped == null) return null;
    if (typeof wrapped === 'object' && 'v' in (wrapped as Record<string, unknown>)) {
      return (wrapped as { v: T }).v;
    }
    return wrapped as T;
  } catch {
    return null;
  }
}

async function putJson(key: string, value: unknown): Promise<void> {
  try {
    const res = await fetch(`${API}/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ v: value }),
    });
    if (!res.ok) {
      console.warn('[ServerStorage] PUT failed', key, res.status, await res.text());
    }
  } catch (e) {
    console.warn('[ServerStorage] PUT exception', key, e);
  }
}

export class ServerStorage implements Storage {
  async getViewingKey(walletAddr: string): Promise<bigint | null> {
    const v = await getJson<string>(vkKey(walletAddr));
    if (!v) return null;
    try {
      return BigInt(v);
    } catch {
      return null;
    }
  }
  async setViewingKey(walletAddr: string, key: bigint): Promise<void> {
    // Stored as a 0x-prefixed hex string — JSON doesn't have a bigint type
    // and we want the value human-readable in the server's data file.
    await putJson(vkKey(walletAddr), '0x' + key.toString(16));
  }
  async isOnboarded(walletAddr: string): Promise<boolean> {
    return (await getJson<boolean>(obKey(walletAddr))) === true;
  }
  async markOnboarded(walletAddr: string): Promise<void> {
    await putJson(obKey(walletAddr), true);
  }
  async getPayrollAddress(walletAddr: string): Promise<string | null> {
    return await getJson<string>(paKey(walletAddr));
  }
  async setPayrollAddress(walletAddr: string, payrollAddr: string): Promise<void> {
    await putJson(paKey(walletAddr), payrollAddr);
  }
  async getPayrollClassHash(): Promise<string | null> {
    return await getJson<string>(CLASS_HASH_KEY);
  }
  async setPayrollClassHash(classHash: string): Promise<void> {
    await putJson(CLASS_HASH_KEY, classHash);
  }
}
