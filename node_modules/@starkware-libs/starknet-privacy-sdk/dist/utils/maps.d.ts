import type { BigNumberish } from "starknet";
/**
 * A flexible Map with optional key conversion and default value generation.
 *
 * @typeParam K - The key type used in the public API
 * @typeParam V - The value type
 * @typeParam InternalK - The internal key type used for storage (defaults to K)
 *
 * Features:
 * - Key conversion: Transform keys before storage (e.g., BigNumberish → bigint)
 * - Default factory: Auto-create values for missing keys
 *
 * Iteration methods (entries, keys, forEach) use InternalK for keys.
 */
export declare class AdvancedMap<K, V, InternalK = K> {
    private map;
    private options;
    constructor(options?: {
        keyConverter?: (key: K) => InternalK;
        defaultFactory?: (key: K) => V;
    });
    constructor(entries: Iterable<readonly [K, V]> | null, options?: {
        keyConverter?: (key: K) => InternalK;
        defaultFactory?: (key: K) => V;
    });
    private toInternalKey;
    get(key: K, defaultValue?: (key: K) => V): V | undefined;
    set(key: K, value: V): this;
    has(key: K): boolean;
    delete(key: K): boolean;
    clear(): void;
    get size(): number;
    /** Iterate over entries with internal keys */
    entries(): IterableIterator<[InternalK, V]>;
    /** Iterate over internal keys */
    keys(): IterableIterator<InternalK>;
    /** Iterate over values */
    values(): IterableIterator<V>;
    /** ForEach with internal keys */
    forEach(callbackfn: (value: V, key: InternalK, map: Map<InternalK, V>) => void): void;
    [Symbol.iterator](): IterableIterator<[InternalK, V]>;
    get [Symbol.toStringTag](): string;
}
/**
 * A Map that accepts BigNumberish keys and normalizes them to bigint.
 * Optionally auto-creates default values for missing keys.
 *
 * @example
 * // Without defaults - get() returns V | undefined
 * const map = new AddressMap<number>();
 * map.get("0x1"); // number | undefined
 *
 * // With defaults - get() returns V (use non-null assertion or check)
 * const mapWithDefault = new AddressMap<number[]>(() => []);
 * mapWithDefault.get("0x1")!.push(42); // safe when defaultFactory provided
 */
export declare class BigNumberishMap<V> extends AdvancedMap<BigNumberish, V, bigint> {
    constructor(defaultFactory?: (key: BigNumberish) => V);
    constructor(entries: Iterable<readonly [BigNumberish, V]> | null, defaultFactory?: (key: BigNumberish) => V);
}
export declare const AddressMap: typeof BigNumberishMap;
export type AddressMap<V> = BigNumberishMap<V>;
//# sourceMappingURL=maps.d.ts.map