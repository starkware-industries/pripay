use starknet::{ClassHash, ContractAddress};

#[derive(Drop, Serde)]
pub struct Call {
    pub to: ContractAddress,
    pub selector: felt252,
    pub calldata: Array<felt252>,
}

#[starknet::interface]
pub trait IPayrollContract<TContractState> {
    fn is_valid_signature(
        self: @TContractState, hash: felt252, signature: Array<felt252>,
    ) -> felt252;
    fn execute(ref self: TContractState, calls: Array<Call>);
}

// Minimal SNIP-6 account interface — used to delegate signature verification to
// the owner wallet's own account contract.
#[starknet::interface]
pub trait ISRC6<TContractState> {
    fn is_valid_signature(
        self: @TContractState, hash: felt252, signature: Array<felt252>,
    ) -> felt252;
}

#[starknet::interface]
pub trait IUpgradeable<TContractState> {
    fn upgrade(
        ref self: TContractState,
        new_class_hash: ClassHash,
        eic_data: Option<(ClassHash, Span<felt252>)>,
    );
}

#[starknet::interface]
pub trait IEIC<TContractState> {
    fn eic_initialize(ref self: TContractState, data: Span<felt252>);
}

/// Emitted when the contract's class hash is replaced via `upgrade`.
#[derive(Drop, Debug, PartialEq, starknet::Event)]
pub struct Upgraded {
    pub class_hash: ClassHash,
}
