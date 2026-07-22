export declare const INITIAL_OFFSET = 8;
export declare const INITIAL_STEP = 8;
type Probe = (i: number, skipResult?: boolean) => Promise<boolean>;
export declare class Tracker {
    private pending;
    private errors;
    add<T>(p: Promise<T>): Promise<T>;
    wait(): Promise<void>;
}
export declare function bisect(probe: Probe, start: number, end: number, tracker?: Tracker, lengthOnly?: boolean): Promise<void>;
export declare function scan(probe: Probe, start: number, tracker?: Tracker, lengthOnly?: boolean): Promise<void>;
export {};
//# sourceMappingURL=scan.d.ts.map