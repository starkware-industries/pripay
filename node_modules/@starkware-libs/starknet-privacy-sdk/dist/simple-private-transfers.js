import { Open, } from "./interfaces.js"; // Assuming you moved interfaces
import { toBigInt } from "./utils/convert.js";
import { toHex } from "./utils/convert.js";
import { AddressMap } from "./utils/maps.js";
import { isAll } from "./utils/validation.js";
export class SimplePrivateTransfersImpl {
    inner;
    constructor(inner) {
        this.inner = inner;
    }
    get user() {
        return this.inner.user;
    }
    registry = {
        channels: new AddressMap(),
        notes: new AddressMap(),
    };
    deposit(token, amount) {
        return this.build(token).deposit({ amount }).execute();
    }
    withdraw(token, recipient, amount) {
        const builder = this.build(token);
        const surplustWithdraw = isAll(amount) ? true : false;
        if (!isAll(amount)) {
            builder.withdraw({ recipient, amount });
        }
        return builder.surplusTo(recipient, surplustWithdraw).execute();
    }
    transfer(token, recipient, amount) {
        const builder = this.build(token);
        if (isAll(amount)) {
            // Transfer all: send everything as surplus to recipient
            return builder.surplusTo(recipient, false).execute();
        }
        // Transfer specific amount: send amount to recipient, keep surplus
        return builder.transfer({ recipient, amount }).surplusTo(this.inner.user, false).execute();
    }
    swap(fromToken, fromAmount, toToken, executor) {
        const toTokenAddress = toBigInt(toToken);
        return this.build(fromToken)
            .withdraw({ recipient: executor, amount: fromAmount })
            .surplusTo(this.inner.user, false) // Keep ACE surplus as private note
            .with(toToken)
            .transfer({ recipient: this.inner.user, amount: Open })
            .done()
            .invoke(({ openNotes, withdrawals }) => {
            return {
                contractAddress: toHex(executor),
                calldata: [
                    withdrawals[0].token,
                    toTokenAddress,
                    withdrawals[0].amount,
                    openNotes[0].noteId,
                ],
            };
        })
            .execute();
    }
    build(token) {
        // Clear notes before refresh to avoid stale entries (already-spent notes)
        this.registry.notes.clear();
        return this.inner
            .build({
            autoDiscover: { notes: "refresh", channels: "refresh" },
            autoSetup: true,
            autoSelectNotes: "all",
            registry: this.registry,
        })
            .with(token);
    }
}
//# sourceMappingURL=simple-private-transfers.js.map