// Persistence boundary for per-wallet state: viewing key, payroll contract
// address (for future multi-tenant), and an onboarded flag.
//
// All keys are the owner's wallet address (the EOA that owns PayrollContract). Storage
// is async so the same interface fits a future HTTP-backed SQLite service.
export interface Storage {
  getViewingKey(walletAddr: string): Promise<bigint | null>
  setViewingKey(walletAddr: string, key: bigint): Promise<void>

  // Returns true if the SetViewingKey action has been submitted to the pool for
  // this wallet's PayrollContract. Onboarding orchestrator first probes the
  // pool itself (source of truth) and only consults this for fast paths.
  isOnboarded(walletAddr: string): Promise<boolean>
  markOnboarded(walletAddr: string): Promise<void>

  // Per-wallet PayrollContract address. Populated after the first onboard
  // deploys the contract — subsequent onboards reuse the same instance.
  getPayrollAddress(walletAddr: string): Promise<string | null>
  setPayrollAddress(walletAddr: string, payrollAddr: string): Promise<void>

  // Network-wide declared class hash for the PayrollContract. Stored
  // because the actual on-chain class hash differs slightly from what
  // starknet.js pre-computes (the wallet's abi re-serialization changes
  // the keccak). After the first successful declare we cache the real
  // hash returned by the declare receipt.
  getPayrollClassHash(): Promise<string | null>
  setPayrollClassHash(classHash: string): Promise<void>
}

// In-process fallback used when the server-backed store is unreachable. Lost on
// page reload, so it only carries state within a single session.
export class InMemoryStorage implements Storage {
  private viewingKeys = new Map<string, bigint>()
  private onboarded = new Set<string>()
  private payrollAddresses = new Map<string, string>()
  private payrollClassHash: string | null = null

  async getViewingKey(walletAddr: string): Promise<bigint | null> {
    return this.viewingKeys.get(walletAddr.toLowerCase()) ?? null
  }
  async setViewingKey(walletAddr: string, key: bigint): Promise<void> {
    this.viewingKeys.set(walletAddr.toLowerCase(), key)
  }
  async isOnboarded(walletAddr: string): Promise<boolean> {
    return this.onboarded.has(walletAddr.toLowerCase())
  }
  async markOnboarded(walletAddr: string): Promise<void> {
    this.onboarded.add(walletAddr.toLowerCase())
  }
  async getPayrollAddress(walletAddr: string): Promise<string | null> {
    return this.payrollAddresses.get(walletAddr.toLowerCase()) ?? null
  }
  async setPayrollAddress(walletAddr: string, payrollAddr: string): Promise<void> {
    this.payrollAddresses.set(walletAddr.toLowerCase(), payrollAddr)
  }
  async getPayrollClassHash(): Promise<string | null> {
    return this.payrollClassHash
  }
  async setPayrollClassHash(classHash: string): Promise<void> {
    this.payrollClassHash = classHash
  }
}
