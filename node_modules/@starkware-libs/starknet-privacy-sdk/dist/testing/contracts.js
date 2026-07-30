/**
 * Mock Contracts registry for testing.
 * Replaces simple ERC20s with a generic contract registry.
 */
import { AddressMap, toBigInt } from "../utils/index.js";
import { assert } from "../utils/validation.js";
export class ERC20 {
    address;
    balances = new AddressMap(() => 0n);
    constructor(address) {
        this.address = address;
    }
    transfer(from, to, amount) {
        assert(this.balances.get(from) >= amount, () => `Insufficient balance`);
        this.balances.set(from, this.balances.get(from) - amount);
        this.balances.set(to, this.balances.get(to) + amount);
    }
    balanceOf(address) {
        return this.balances.get(address);
    }
    setBalance(address, amount) {
        this.balances.set(address, amount);
    }
    increaseBalance(address, amount) {
        const current = this.balances.get(address) ?? 0n;
        this.balances.set(address, current + amount);
    }
}
export class MockSwapAnonymizer {
    address;
    contracts;
    poolAddress;
    constructor(address, contracts, poolAddress) {
        this.address = address;
        this.contracts = contracts;
        this.poolAddress = poolAddress;
    }
    privacy_invoke(fromToken, toToken, amount, noteId) {
        const balance = this.contracts.get(fromToken).balanceOf(this.address);
        assert(balance == amount, () => `Balance mismatch: ${balance} != ${amount}`);
        this.contracts.get(fromToken).setBalance(this.address, 0n);
        this.contracts.get(toToken).setBalance(this.address, amount * 2n);
        this.contracts
            .get(toBigInt(this.poolAddress))
            .openDeposit(toBigInt(noteId), toBigInt(toToken), amount * 2n, toBigInt(this.address));
    }
}
export class MockContracts {
    contracts = new AddressMap((address) => new ERC20(address));
    constructor(...contracts) {
        for (const contract of contracts) {
            this.register(contract);
        }
    }
    /**
     * Get a contract instance. Defaults to creating a new ERC20 if not found.
     * Can be typed with a generic if the contract type is known.
     */
    get(address) {
        return this.contracts.get(address);
    }
    /**
     * Register a contract instance manually.
     */
    register(contract) {
        this.contracts.set(contract.address, contract);
    }
    /**
     * Execute a call on a contract.
     * This is a helper for executing arbitrary calls, e.g. from InvokeExternal actions.
     * It attempts to find the method on the mock contract instance and invoke it.
     */
    call(contractAddress, method, args = []) {
        const contract = this.get(contractAddress);
        if (typeof contract[method] === "function") {
            return contract[method].call(contract, ...args);
        }
        throw new Error(`Method ${method} not found on contract at ${contractAddress}`);
    }
}
//# sourceMappingURL=contracts.js.map