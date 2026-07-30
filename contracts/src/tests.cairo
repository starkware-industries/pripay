// snforge integration tests for PayrollContract. Kept out of contract.cairo so
// the contract source is test-free; the test-only MockEIC fixture lives in
// `crate::mocks` (also cfg(test)).
use openzeppelin_interfaces::access::ownable::{
    IOwnableTwoStepDispatcher, IOwnableTwoStepDispatcherTrait,
};
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, EventSpyAssertionsTrait, declare, spy_events,
    start_cheat_caller_address,
};
use starknet::{ClassHash, ContractAddress};
use crate::contract::PayrollContract::{Event, snip12_message_hash};
use crate::interface::{
    IPayrollContractDispatcher, IPayrollContractDispatcherTrait, IUpgradeableDispatcher,
    IUpgradeableDispatcherTrait, Upgraded,
};

fn OWNER() -> ContractAddress {
    'OWNER'.try_into().unwrap()
}

fn EVE() -> ContractAddress {
    'EVE'.try_into().unwrap()
}

fn NEW_OWNER() -> ContractAddress {
    'NEW_OWNER'.try_into().unwrap()
}

// Deploy a fresh PayrollContract owned by OWNER(); returns its address.
fn deploy() -> ContractAddress {
    let cls = declare("PayrollContract").unwrap().contract_class();
    let (addr, _) = cls.deploy(@array![OWNER().into()]).unwrap();
    addr
}

// Class hash of a contract by name (declares it if needed).
fn class_hash_of(name: ByteArray) -> ClassHash {
    *declare(name).unwrap().contract_class().class_hash
}

#[test]
fn constructor_sets_owner() {
    let addr = deploy();
    let owner = IOwnableTwoStepDispatcher { contract_address: addr }.owner();
    assert(owner == OWNER(), 'owner not set');
}

// Ownership transfer is two-step: transfer_ownership only sets the
// pending owner; the transfer completes when the pending owner accepts.
#[test]
fn transfer_ownership_is_two_step() {
    let addr = deploy();
    let ownable = IOwnableTwoStepDispatcher { contract_address: addr };

    start_cheat_caller_address(addr, OWNER());
    ownable.transfer_ownership(NEW_OWNER());
    // Not transferred yet — owner unchanged, pending recorded.
    assert(ownable.owner() == OWNER(), 'owner changed too early');
    assert(ownable.pending_owner() == NEW_OWNER(), 'pending not set');

    start_cheat_caller_address(addr, NEW_OWNER());
    ownable.accept_ownership();
    assert(ownable.owner() == NEW_OWNER(), 'owner not transferred');
}

#[test]
#[should_panic(expected: 'Caller is not the owner')]
fn transfer_ownership_rejects_non_owner() {
    let addr = deploy();
    let ownable = IOwnableTwoStepDispatcher { contract_address: addr };
    start_cheat_caller_address(addr, EVE());
    ownable.transfer_ownership(EVE());
}

#[test]
#[should_panic(expected: 'Caller is not the pending owner')]
fn accept_ownership_rejects_non_pending() {
    let addr = deploy();
    let ownable = IOwnableTwoStepDispatcher { contract_address: addr };
    start_cheat_caller_address(addr, OWNER());
    ownable.transfer_ownership(NEW_OWNER());
    start_cheat_caller_address(addr, EVE());
    ownable.accept_ownership();
}

// renounce_ownership is disabled to prevent permanently bricking the
// contract by zeroing the owner.
#[test]
#[should_panic(expected: 'Renounce disabled')]
fn renounce_ownership_is_disabled() {
    let addr = deploy();
    let ownable = IOwnableTwoStepDispatcher { contract_address: addr };
    start_cheat_caller_address(addr, OWNER());
    ownable.renounce_ownership();
}

#[test]
fn execute_allows_owner() {
    let addr = deploy();
    let payroll = IPayrollContractDispatcher { contract_address: addr };
    start_cheat_caller_address(addr, OWNER());
    payroll.execute(array![]); // empty batch: owner check passes, no-op
}

#[test]
#[should_panic(expected: 'Caller is not the owner')]
fn execute_rejects_non_owner() {
    let addr = deploy();
    let payroll = IPayrollContractDispatcher { contract_address: addr };
    start_cheat_caller_address(addr, EVE());
    payroll.execute(array![]);
}

// upgrade() is owner-gated (hybrid contract — the owner calls it
// directly): a non-owner caller is rejected.
#[test]
#[should_panic(expected: 'Caller is not the owner')]
fn upgrade_rejects_non_owner() {
    let addr = deploy();
    let upgradeable = IUpgradeableDispatcher { contract_address: addr };
    start_cheat_caller_address(addr, EVE());
    upgradeable.upgrade(0x123.try_into().unwrap(), Option::None);
}

// Success path: the owner replaces the class and Upgraded is emitted. We
// replace to PayrollContract's own (already-declared) class hash.
#[test]
fn upgrade_by_owner_replaces_class_and_emits() {
    let addr = deploy();
    let new_class = class_hash_of("PayrollContract");
    let mut spy = spy_events();
    let upgradeable = IUpgradeableDispatcher { contract_address: addr };
    start_cheat_caller_address(addr, OWNER());
    upgradeable.upgrade(new_class, Option::None);
    spy.assert_emitted(@array![(addr, Event::Upgraded(Upgraded { class_hash: new_class }))]);
}

// EIC path: when eic_data is Some, the External Initializer Contract is
// library-called before the class swap. MockEIC panics 'EIC_RAN' on
// entry, proving the branch executed.
#[test]
#[should_panic(expected: 'EIC_RAN')]
fn upgrade_runs_eic_before_replace() {
    let addr = deploy();
    let new_class = class_hash_of("PayrollContract");
    let eic_class = class_hash_of("MockEIC");
    let upgradeable = IUpgradeableDispatcher { contract_address: addr };
    start_cheat_caller_address(addr, OWNER());
    upgradeable.upgrade(new_class, Option::Some((eic_class, array!['x'].span())));
}

// Fixtures generated with starknet.js typedData.getMessageHash over
//   domain { name:'PriPay', version:'1', chainId, revision:'1' }
//   message { hash } , signer = account address.
#[test]
fn snip12_hash_matches_starknetjs_sepolia() {
    let got = snip12_message_hash(0xabc, 0x123, 'SN_SEPOLIA');
    assert(
        got == 0x54056c428c70d90784218f46494361d95900725b2f7beaf95c4205d9f96e63b,
        'snip12 sepolia mismatch',
    );
}

#[test]
fn snip12_hash_matches_starknetjs_mainnet() {
    let got = snip12_message_hash(
        0xdeadbeef, 0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7, 'SN_MAIN',
    );
    assert(
        got == 0x1b1e38045257b2111e795808365bc96c9ec10d7817fe34d485ec0ea5f72a7d4,
        'snip12 mainnet mismatch',
    );
}
