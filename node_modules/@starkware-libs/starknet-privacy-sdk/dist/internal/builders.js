/**
 * Builder implementations for constructing private transfer operations.
 */
import { Open, } from "../interfaces.js";
import { AddressMap, toBigInt } from "../utils/index.js";
import { debugLog } from "../utils/logging.js";
import { isOpenNote } from "../utils/validation.js";
// ============ Token Operations Builder ============
export class TokenOperationsBuilderImpl {
    parentBuilder;
    // Actions stored without context - context resolved during execute
    openTokenChannels = [];
    useNotes = [];
    deposits = [];
    createNotes = [];
    withdraws = [];
    // Surplus recipient (overrides parent builder's surplus recipient for this token)
    surplusAction;
    token;
    constructor(parentBuilder, token) {
        this.parentBuilder = parentBuilder;
        this.token = toBigInt(token);
        debugLog("builder", `TokenBuilder created for ${token}`);
    }
    setup(recipient) {
        debugLog("builder", `TokenBuilder.setup for ${this.token} -> ${recipient}`);
        this.openTokenChannels.push({ recipient: toBigInt(recipient), token: this.token });
        return this;
    }
    inputs(...notes) {
        for (const note of notes) {
            this.useNotes.push({ token: this.token, note });
        }
        return this;
    }
    deposit(...inputs) {
        debugLog("builder", `TokenBuilder.deposit for ${this.token}`, inputs);
        for (const input of inputs) {
            this.deposits.push({ token: this.token, amount: input.amount });
            if (input.recipient !== undefined) {
                // similar to an explicit transfer
                this.createNotes.push({
                    token: this.token,
                    amount: input.amount,
                    recipient: toBigInt(input.recipient),
                });
            }
        }
        return this;
    }
    withdraw(...outputs) {
        for (const output of outputs) {
            this.withdraws.push({
                token: this.token,
                recipient: toBigInt(output.recipient ?? this.parentBuilder.userAddress),
                amount: output.amount,
            });
        }
        return this;
    }
    transfer(...outputs) {
        for (const output of outputs) {
            if (isOpenNote(output)) {
                this.createNotes.push({
                    token: this.token,
                    recipient: toBigInt(output.recipient),
                    amount: Open,
                });
            }
            else {
                this.createNotes.push({
                    token: this.token,
                    recipient: toBigInt(output.recipient),
                    amount: output.amount,
                });
            }
        }
        return this;
    }
    surplusTo(recipient, withdraw) {
        this.surplusAction = { recipient: toBigInt(recipient), token: this.token, withdraw };
        return this;
    }
    with(token, ops) {
        if (ops) {
            ops(this.parentBuilder.with(token));
            return this;
        }
        return this.parentBuilder.with(token);
    }
    done() {
        return this.parentBuilder;
    }
    async execute(options) {
        return this.parentBuilder.execute(options);
    }
    async createProofInvocation(options) {
        return this.parentBuilder.createProofInvocation(options);
    }
    async simulate(options) {
        return this.parentBuilder.simulate(options);
    }
}
// ============ Private Transfers Builder ============
export class PrivateTransfersBuilderImpl {
    transfers;
    userAddress;
    setViewingKey;
    openChannels = [];
    invokeExternal;
    tokenBuilders = new AddressMap((token) => new TokenOperationsBuilderImpl(this, token));
    // Default surplus recipient for all tokens
    defaultSurplusAction;
    // Options passed at build time
    buildOptions;
    constructor(transfers, userAddress, options) {
        this.transfers = transfers;
        this.userAddress = userAddress;
        this.buildOptions = options;
    }
    register() {
        this.setViewingKey = {};
        return this;
    }
    setup(recipient) {
        this.openChannels.push({ recipient: toBigInt(recipient) });
        return this;
    }
    invoke(callBuilder) {
        if (this.invokeExternal !== undefined) {
            throw new Error("At most one .invoke() per transaction; already set.");
        }
        this.invokeExternal = {
            callBuilder,
        };
        return this;
    }
    surplusTo(recipient, withdraw) {
        this.defaultSurplusAction = { recipient: toBigInt(recipient), token: undefined, withdraw };
        return this;
    }
    with(token, ops) {
        const tokenBuilder = this.tokenBuilders.get(token);
        if (ops) {
            ops(tokenBuilder);
            return this;
        }
        return tokenBuilder;
    }
    collectActionsAndOptions(options) {
        const mergedOptions = {
            ...this.buildOptions,
            ...options,
            autoDiscover: {
                ...this.buildOptions?.autoDiscover,
                ...options?.autoDiscover,
            },
        };
        const openTokenChannels = [];
        const deposits = [];
        const useNotes = [];
        const createNotes = [];
        const withdraws = [];
        const surpluses = [];
        for (const [token, tokenBuilder] of this.tokenBuilders.entries()) {
            debugLog("builder", `Collecting actions for ${token}`, {
                openTokenChannels: tokenBuilder.openTokenChannels,
                deposits: tokenBuilder.deposits.length,
            });
            openTokenChannels.push(...tokenBuilder.openTokenChannels);
            deposits.push(...tokenBuilder.deposits);
            useNotes.push(...tokenBuilder.useNotes);
            createNotes.push(...tokenBuilder.createNotes);
            withdraws.push(...tokenBuilder.withdraws);
            const surplusToAction = tokenBuilder.surplusAction ?? this.defaultSurplusAction;
            if (surplusToAction) {
                surpluses.push({ ...surplusToAction, token });
            }
        }
        const actions = {
            setViewingKey: this.setViewingKey,
            openChannels: this.openChannels,
            openTokenChannels,
            deposits,
            useNotes,
            createNotes,
            withdraws,
            surpluses,
            invoke: this.invokeExternal,
        };
        return { actions, mergedOptions };
    }
    async execute(options) {
        debugLog("builder", "PrivateTransfersBuilderImpl.execute called");
        const { actions, mergedOptions } = this.collectActionsAndOptions(options);
        return this.transfers.execute(actions, mergedOptions);
    }
    async createProofInvocation(options) {
        debugLog("builder", "PrivateTransfersBuilderImpl.createProofInvocation called");
        const { actions, mergedOptions } = this.collectActionsAndOptions(options);
        return this.transfers.createProofInvocation(actions, mergedOptions);
    }
    async simulate(options) {
        debugLog("builder", "PrivateTransfersBuilderImpl.simulate called");
        const { actions, mergedOptions } = this.collectActionsAndOptions();
        return this.transfers.simulate(actions, { ...mergedOptions, ...options });
    }
}
//# sourceMappingURL=builders.js.map