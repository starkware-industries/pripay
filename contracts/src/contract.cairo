use crate::interface::IPayrollContract;

// PayrollContract — single-tenant per wallet.
//
// Acts as a thin "account-shaped" identity contract for the privacy pool:
//   - `is_valid_signature(h, sig)` verifies that `sig` is the owner wallet's
//     SNIP-12 signature over the typed message `{ hash: h }`, where `h` is the
//     V3 proof-invocation tx hash the pool's proof simulates against. It
//     reconstructs the SNIP-12 message hash (bound to the owner address + the
//     live chain id) and delegates the ECDSA check to the owner account's own
//     `is_valid_signature` — so no key is stored here and wallet key rotation /
//     Fordefi MPC just work.
//   - `execute(calls)` lets the owner dispatch arbitrary calls via this
//     contract (e.g. `token.approve(pool, MAX)`).
#[starknet::contract]
pub mod PayrollContract {
    use core::poseidon::poseidon_hash_span;
    use openzeppelin_access::ownable::OwnableComponent;
    use openzeppelin_interfaces::access::ownable::IOwnableTwoStep;
    use starknet::storage::StoragePointerReadAccess;
    use starknet::syscalls::{call_contract_syscall, replace_class_syscall};
    use starknet::{ClassHash, ContractAddress, SyscallResultTrait, get_tx_info};
    use crate::interface::{
        Call, IEICDispatcherTrait, IEICLibraryDispatcher, ISRC6Dispatcher, ISRC6DispatcherTrait,
        IUpgradeable, Upgraded,
    };
    use super::IPayrollContract;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    // InternalImpl gives us initializer / assert_only_owner.
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    // Two-step ownership: `transfer_ownership` proposes a pending owner who must
    // then `accept_ownership`.
    // `renounce_ownership` is disabled.
    // zeroing the owner would permanently brick execute / upgrade / signature
    // delegation with no recovery. We expose snake_case `IOwnableTwoStep` only;
    // the camelCase two-step mixin would re-add a `renounceOwnership` that
    // bypasses this guard.
    #[abi(embed_v0)]
    impl OwnableTwoStepImpl of IOwnableTwoStep<ContractState> {
        fn owner(self: @ContractState) -> ContractAddress {
            self.ownable.owner()
        }

        fn pending_owner(self: @ContractState) -> ContractAddress {
            self.ownable.pending_owner()
        }

        fn accept_ownership(ref self: ContractState) {
            self.ownable.accept_ownership();
        }

        fn transfer_ownership(ref self: ContractState, new_owner: ContractAddress) {
            self.ownable.transfer_ownership(new_owner);
        }

        fn renounce_ownership(ref self: ContractState) {
            core::panic_with_felt252('Renounce disabled');
        }
    }

    // SNIP-12 (revision 1) constants for the typed message the treasury wallet
    // signs:
    //   domain  = { name: 'PriPay', version: 1, chainId: <tx chain id>, revision: 1 }
    //   Message = { hash: felt }
    // The two type hashes are `starknet_keccak` of the encoded type strings;
    // they are precomputed off-chain and asserted equal to starknet.js
    // `getTypeHash(...)` in the test suite. `version`/`revision` encode as the
    // numbers 1 (starknet.js treats numeric domain strings as felts, not ascii).
    const STARKNET_MESSAGE: felt252 = 'StarkNet Message';
    const STARKNET_DOMAIN_TYPE_HASH: felt252 =
        0x1ff2f602e42168014d405a94f75e8a93d640751d71d16311266e140d8b0a210;
    const MESSAGE_TYPE_HASH: felt252 =
        0x16a33dca499bb0eafbd5b97b1e86eb85147c19b42b9c144a12c809ee577c175;
    const DOMAIN_NAME: felt252 = 'PriPay';
    const DOMAIN_VERSION: felt252 = 1;
    const DOMAIN_REVISION: felt252 = 1;
    const VALID: felt252 = 'VALID';

    #[storage]
    struct Storage {
        #[substorage(v0)]
        ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub(crate) enum Event {
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        Upgraded: Upgraded,
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress) {
        self.ownable.initializer(owner);
    }

    #[abi(embed_v0)]
    impl PayrollContractImpl of IPayrollContract<ContractState> {
        fn is_valid_signature(
            self: @ContractState, hash: felt252, signature: Array<felt252>,
        ) -> felt252 {
            let owner = self.ownable.Ownable_owner.read();
            let chain_id = get_tx_info().unbox().chain_id;
            let message_hash = snip12_message_hash(hash, owner.into(), chain_id);
            // Accounts return 'VALID' (SNIP-6) or 1 (ERC-1271-style).
            ISRC6Dispatcher { contract_address: owner }.is_valid_signature(message_hash, signature)
        }

        fn execute(ref self: ContractState, calls: Array<Call>) {
            self.ownable.assert_only_owner();

            for call in calls {
                call_contract_syscall(call.to, call.selector, call.calldata.span())
                    .unwrap_syscall();
            }
        }
    }

    #[abi(embed_v0)]
    impl UpgradeableImpl of IUpgradeable<ContractState> {
        fn upgrade(
            ref self: ContractState,
            new_class_hash: ClassHash,
            eic_data: Option<(ClassHash, Span<felt252>)>,
        ) {
            // PriPay is an identity contract, not a standard account,
            // thus upgrade is limited to the owner rather than on a self-call.
            self.ownable.assert_only_owner();
            // Optional External Initializer Contract, run migration logic in this contract's
            // context.
            if let Some((eic_class_hash, eic_init_data)) = eic_data {
                IEICLibraryDispatcher { class_hash: eic_class_hash }.eic_initialize(eic_init_data);
            }
            replace_class_syscall(new_class_hash).unwrap_syscall();
            self.emit(Upgraded { class_hash: new_class_hash });
        }
    }

    // SNIP-12 rev-1 message hash for `{ hash }`, bound to `signer` (the owner
    // wallet address starknet.js binds during signMessage) and `chain_id`.
    pub(crate) fn snip12_message_hash(
        hash: felt252, signer: felt252, chain_id: felt252,
    ) -> felt252 {
        let domain_separator = poseidon_hash_span(
            array![
                STARKNET_DOMAIN_TYPE_HASH, DOMAIN_NAME, DOMAIN_VERSION, chain_id, DOMAIN_REVISION,
            ]
                .span(),
        );
        let struct_hash = poseidon_hash_span(array![MESSAGE_TYPE_HASH, hash].span());
        poseidon_hash_span(array![STARKNET_MESSAGE, domain_separator, signer, struct_hash].span())
    }
}
