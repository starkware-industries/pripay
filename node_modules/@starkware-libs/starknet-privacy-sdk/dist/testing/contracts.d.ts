/**
 * Mock Contracts registry for testing.
 * Replaces simple ERC20s with a generic contract registry.
 */
import type { Amount, NoteId, StarknetAddress } from "../interfaces.js";
/** Interface for any mock contract */
export interface MockContract {
    address: StarknetAddress;
    [key: string]: unknown;
}
export declare class ERC20 implements MockContract {
    address: StarknetAddress;
    private balances;
    [key: string]: unknown;
    constructor(address: StarknetAddress);
    transfer(from: StarknetAddress, to: StarknetAddress, amount: Amount): void;
    balanceOf(address: StarknetAddress): Amount;
    setBalance(address: StarknetAddress, amount: Amount): void;
    increaseBalance(address: StarknetAddress, amount: Amount): void;
}
export declare class MockSwapAnonymizer implements MockContract {
    address: StarknetAddress;
    private contracts;
    private poolAddress;
    [key: string]: unknown;
    constructor(address: StarknetAddress, contracts: MockContracts, poolAddress: StarknetAddress);
    privacy_invoke(fromToken: StarknetAddress, toToken: StarknetAddress, amount: Amount, noteId: NoteId): void;
}
export declare class MockContracts {
    private contracts;
    constructor(...contracts: MockContract[]);
    /**
     * Get a contract instance. Defaults to creating a new ERC20 if not found.
     * Can be typed with a generic if the contract type is known.
     */
    get<T extends MockContract = ERC20>(address: StarknetAddress): T;
    /**
     * Register a contract instance manually.
     */
    register(contract: MockContract): void;
    /**
     * Execute a call on a contract.
     * This is a helper for executing arbitrary calls, e.g. from InvokeExternal actions.
     * It attempts to find the method on the mock contract instance and invoke it.
     */
    call(contractAddress: StarknetAddress, method: string, args?: unknown[]): unknown;
}
//# sourceMappingURL=contracts.d.ts.map