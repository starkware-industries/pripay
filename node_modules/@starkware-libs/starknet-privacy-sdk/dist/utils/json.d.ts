/**
 * JSON.stringify replacement that handles BigInt, Map, and Set.
 * - BigInts → { "__bigint__": "12345" }
 * - Maps → { "__map__": [[key, value], ...] }
 * - Sets → { "__set__": [value, ...] }
 */
export declare function jsonStringify(value: unknown): string;
/**
 * JSON.parse replacement that restores BigInt, Map, and Set.
 */
export declare function jsonParse<T = unknown>(text: string): T;
//# sourceMappingURL=json.d.ts.map