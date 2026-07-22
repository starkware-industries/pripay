/**
 * Pool calldata-mode selection by deployed class hash.
 *
 * The mode is a lookup of the pool's class hash (the first felt of the prove
 * response's payload) against the pinned pre-screening pools — no RPC.
 * Unpinned class hashes are treated as screening-capable, so an upgraded pool
 * activates without an SDK release; source-built test pools pass an explicit
 * `poolMode` override instead.
 */
/** Whether the target pool expects the screening attestation in `apply_actions` calldata. */
export type PoolCapabilityMode = "screening" | "compatibility";
/** Class hashes of the deployed pre-screening pools. */
export declare const COMPATIBILITY_POOL_CLASS_HASHES: readonly bigint[];
/**
 * Select the calldata mode by pool class hash. `undefined` or an unparseable
 * felt selects compatibility — such a proof is unusable on-chain anyway, so
 * no attestation suffix is invented for it.
 */
export declare function poolModeForClassHash(classHashFelt: string | undefined): PoolCapabilityMode;
//# sourceMappingURL=pool-mode.d.ts.map