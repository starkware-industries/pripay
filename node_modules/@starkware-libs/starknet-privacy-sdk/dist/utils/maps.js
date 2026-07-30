import { toBigInt } from "./crypto.js";
// ============ Utility Classes ============
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
export class AdvancedMap {
    map = new Map();
    options;
    constructor(entriesOrOptions, options) {
        let initialEntries = null;
        if (entriesOrOptions === null || entriesOrOptions === undefined) {
            this.options = options || {};
        }
        else if (Symbol.iterator in Object(entriesOrOptions)) {
            initialEntries = entriesOrOptions;
            this.options = options || {};
        }
        else {
            this.options =
                entriesOrOptions || {};
        }
        if (initialEntries) {
            for (const [key, value] of initialEntries) {
                this.set(key, value);
            }
        }
    }
    toInternalKey(key) {
        return this.options.keyConverter
            ? this.options.keyConverter(key)
            : key;
    }
    get(key, defaultValue) {
        const internalKey = this.toInternalKey(key);
        if (!this.map.has(internalKey) && (defaultValue || this.options.defaultFactory)) {
            this.map.set(internalKey, defaultValue ? defaultValue(key) : this.options.defaultFactory(key));
        }
        return this.map.get(internalKey);
    }
    set(key, value) {
        this.map.set(this.toInternalKey(key), value);
        return this;
    }
    has(key) {
        return this.map.has(this.toInternalKey(key));
    }
    delete(key) {
        return this.map.delete(this.toInternalKey(key));
    }
    clear() {
        this.map.clear();
    }
    get size() {
        return this.map.size;
    }
    /** Iterate over entries with internal keys */
    entries() {
        return this.map.entries();
    }
    /** Iterate over internal keys */
    keys() {
        return this.map.keys();
    }
    /** Iterate over values */
    values() {
        return this.map.values();
    }
    /** ForEach with internal keys */
    forEach(callbackfn) {
        this.map.forEach(callbackfn);
    }
    [Symbol.iterator]() {
        return this.map[Symbol.iterator]();
    }
    get [Symbol.toStringTag]() {
        return "AdvancedMap";
    }
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
export class BigNumberishMap extends AdvancedMap {
    constructor(entriesOrDefaultFactory, defaultFactory) {
        let initialEntries = null;
        let factory;
        if (typeof entriesOrDefaultFactory === "function") {
            factory = entriesOrDefaultFactory;
        }
        else if (Symbol.iterator in Object(entriesOrDefaultFactory) ||
            entriesOrDefaultFactory === null) {
            initialEntries = entriesOrDefaultFactory ?? null;
            factory = defaultFactory;
        }
        super(initialEntries, {
            keyConverter: (key) => toBigInt(key),
            defaultFactory: factory,
        });
    }
}
export const AddressMap = BigNumberishMap;
//# sourceMappingURL=maps.js.map