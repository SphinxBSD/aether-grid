#![cfg(test)]

//! Unit tests for the Eather Grid ZK Coordinates contract.
//!
//! Mocks:
//!  - `MockGameHub`   – no-op hub satisfying the GameHub interface.
//!  - `MockVerifier`  – traps if proof starts with 0xff or is empty; succeeds otherwise.
//!
//! The `energy_used` field is caller-supplied and therefore fully controllable
//! in these tests without needing a real Noir prover.

use crate::{EatherGridContract, EatherGridContractClient, Error, Outcome};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{contract, contractimpl, Address, Bytes, BytesN, Env};

// ============================================================================
// Mock Contracts
// ============================================================================

#[contract]
pub struct MockGameHub;

#[contractimpl]
impl MockGameHub {
    pub fn start_game(
        _env: Env,
        _game_id: Address,
        _session_id: u32,
        _player1: Address,
        _player2: Address,
        _player1_points: i128,
        _player2_points: i128,
    ) {
        // no-op
    }
    pub fn end_game(_env: Env, _session_id: u32, _player1_won: bool) {
        // no-op
    }
    pub fn add_game(_env: Env, _game_address: Address) {
        // no-op
    }
}

/// Mock verifier: traps if proof is empty or starts with 0xff; passes otherwise.
#[contract]
pub struct MockVerifier;

#[contractimpl]
impl MockVerifier {
    pub fn verify_proof(_env: Env, proof: Bytes, _public_inputs: Bytes) {
        if proof.is_empty() {
            panic!("verify_proof: empty proof");
        }
        if proof.get(0) == Some(0xff) {
            panic!("verify_proof: invalid proof");
        }
        // Otherwise: success (no-op).
    }
}

// ============================================================================
// Test Setup
// ============================================================================

struct TestSetup {
    env: Env,
    client: EatherGridContractClient<'static>,
    player1: Address,
    player2: Address,
    verifier_addr: Address,
}

/// A fixed 32-byte treasure hash used as the session's `xy_nullifier_hashed`.
fn test_treasure_hash(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0xABu8; 32])
}

/// Encode `treasure_hash` as the `Bytes` form expected by `submit_zk_proof`.
fn treasure_hash_as_bytes(env: &Env, hash: &BytesN<32>) -> Bytes {
    Bytes::from_array(env, &hash.to_array())
}

/// A valid proof for the MockVerifier: any non-empty bytes not starting with 0xff.
fn valid_proof(env: &Env) -> Bytes {
    Bytes::from_array(env, &[0x01u8; 64])
}

/// An invalid proof that causes MockVerifier to trap.
fn invalid_proof(env: &Env) -> Bytes {
    Bytes::from_array(env, &[0xffu8; 64])
}

fn setup() -> TestSetup {
    let env = Env::default();
    env.mock_all_auths();

    env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: 1_700_000_000,
        protocol_version: 25,
        sequence_number: 100,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: u32::MAX / 2,
        min_persistent_entry_ttl: u32::MAX / 2,
        max_entry_ttl: u32::MAX / 2,
    });

    let admin = Address::generate(&env);
    let hub_addr = env.register(MockGameHub, ());
    let verifier_addr = env.register(MockVerifier, ());
    let contract_id = env.register(EatherGridContract, (&admin, &hub_addr, &verifier_addr));
    let client = EatherGridContractClient::new(&env, &contract_id);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);

    TestSetup {
        env,
        client,
        player1,
        player2,
        verifier_addr,
    }
}

const POINTS: i128 = 100_0000_000;

/// Start a standard game; returns the treasure hash used.
fn start(ts: &TestSetup, session_id: u32) -> BytesN<32> {
    let hash = test_treasure_hash(&ts.env);
    ts.client.start_game(
        &session_id,
        &ts.player1,
        &ts.player2,
        &POINTS,
        &POINTS,
        &hash,
    );
    hash
}

/// Helper to assert an error variant from a try_* call.
fn assert_error<T, E>(
    result: &Result<Result<T, E>, Result<Error, soroban_sdk::InvokeError>>,
    expected: Error,
) {
    match result {
        Err(Ok(actual)) => assert_eq!(
            *actual, expected,
            "expected {expected:?} ({}), got {actual:?}",
            expected as u32
        ),
        Err(Err(_)) => panic!("expected {expected:?} but got invocation error"),
        Ok(Err(_)) => panic!("expected {expected:?} but got conversion error"),
        Ok(Ok(_)) => panic!("expected error {expected:?} but call succeeded"),
    }
}

// ============================================================================
// Game Initialization
// ============================================================================

#[test]
fn test_start_game_stores_treasure_hash() {
    let ts = setup();
    let hash = start(&ts, 1);

    let game = ts.client.get_game(&1u32);
    assert_eq!(game.player1, ts.player1);
    assert_eq!(game.player2, ts.player2);
    assert_eq!(game.treasure_hash, hash);
    assert!(game.player1_energy.is_none());
    assert!(game.player2_energy.is_none());
    assert!(!game.resolved);
}

#[test]
fn test_get_treasure_hash_query() {
    let ts = setup();
    let hash = start(&ts, 2);
    assert_eq!(ts.client.get_treasure_hash(&2u32), hash);
}

#[test]
fn test_different_sessions_have_independent_hashes() {
    let ts = setup();
    // Same hash supplied but sessions are independent objects in storage.
    start(&ts, 10);
    ts.client.start_game(
        &11u32,
        &ts.player1,
        &ts.player2,
        &POINTS,
        &POINTS,
        &BytesN::from_array(&ts.env, &[0xCCu8; 32]),
    );
    let h10 = ts.client.get_treasure_hash(&10u32);
    let h11 = ts.client.get_treasure_hash(&11u32);
    assert_ne!(h10, h11);
}

// ============================================================================
// Winner Resolution — Single Player
// ============================================================================

#[test]
fn test_player1_wins_solo() {
    let ts = setup();
    let hash = start(&ts, 20);
    let pi = treasure_hash_as_bytes(&ts.env, &hash);
    ts.client
        .submit_zk_proof(&20u32, &ts.player1, &valid_proof(&ts.env), &pi, &50u32);
    assert_eq!(ts.client.resolve_game(&20u32), Outcome::Player1Won);
}

#[test]
fn test_player2_wins_solo() {
    let ts = setup();
    let hash = start(&ts, 21);
    let pi = treasure_hash_as_bytes(&ts.env, &hash);
    ts.client
        .submit_zk_proof(&21u32, &ts.player2, &valid_proof(&ts.env), &pi, &50u32);
    assert_eq!(ts.client.resolve_game(&21u32), Outcome::Player2Won);
}

// ============================================================================
// Winner Resolution — Both Players (Energy Tiebreaker)
// ============================================================================

#[test]
fn test_player1_wins_lower_energy() {
    let ts = setup();
    let hash = start(&ts, 30);
    let pi = treasure_hash_as_bytes(&ts.env, &hash);
    ts.client
        .submit_zk_proof(&30u32, &ts.player1, &valid_proof(&ts.env), &pi, &30u32);
    ts.client
        .submit_zk_proof(&30u32, &ts.player2, &valid_proof(&ts.env), &pi, &80u32);
    assert_eq!(ts.client.resolve_game(&30u32), Outcome::Player1Won);
}

#[test]
fn test_player2_wins_lower_energy() {
    let ts = setup();
    let hash = start(&ts, 31);
    let pi = treasure_hash_as_bytes(&ts.env, &hash);
    ts.client
        .submit_zk_proof(&31u32, &ts.player1, &valid_proof(&ts.env), &pi, &100u32);
    ts.client
        .submit_zk_proof(&31u32, &ts.player2, &valid_proof(&ts.env), &pi, &40u32);
    assert_eq!(ts.client.resolve_game(&31u32), Outcome::Player2Won);
}

#[test]
fn test_tie_energy_resolves_to_both_found() {
    let ts = setup();
    let hash = start(&ts, 32);
    let pi = treasure_hash_as_bytes(&ts.env, &hash);
    ts.client
        .submit_zk_proof(&32u32, &ts.player1, &valid_proof(&ts.env), &pi, &50u32);
    ts.client
        .submit_zk_proof(&32u32, &ts.player2, &valid_proof(&ts.env), &pi, &50u32);
    assert_eq!(ts.client.resolve_game(&32u32), Outcome::BothFoundTreasure);
}

// ============================================================================
// Replay & Input Validation
// ============================================================================

#[test]
fn test_wrong_public_inputs_rejected() {
    let ts = setup();
    start(&ts, 40);
    let wrong_pi = Bytes::from_array(&ts.env, &[0x00u8; 32]);
    let result = ts.client.try_submit_zk_proof(
        &40u32,
        &ts.player1,
        &valid_proof(&ts.env),
        &wrong_pi,
        &50u32,
    );
    assert_error(&result, Error::PublicInputMismatch);
}

#[test]
fn test_cross_session_replay_rejected() {
    let ts = setup();
    // Session 50 uses hash 0xAB; session 51 uses a different hash.
    start(&ts, 50);
    let hash50 = test_treasure_hash(&ts.env);
    ts.client.start_game(
        &51u32,
        &ts.player1,
        &ts.player2,
        &POINTS,
        &POINTS,
        &BytesN::from_array(&ts.env, &[0xDDu8; 32]),
    );
    // Use session 50's hash against session 51 → mismatch.
    let pi50 = treasure_hash_as_bytes(&ts.env, &hash50);
    let result =
        ts.client
            .try_submit_zk_proof(&51u32, &ts.player1, &valid_proof(&ts.env), &pi50, &50u32);
    assert_error(&result, Error::PublicInputMismatch);
}

// ============================================================================
// Duplicate & Late Submission
// ============================================================================

#[test]
fn test_cannot_submit_twice() {
    let ts = setup();
    let hash = start(&ts, 60);
    let pi = treasure_hash_as_bytes(&ts.env, &hash);
    ts.client
        .submit_zk_proof(&60u32, &ts.player1, &valid_proof(&ts.env), &pi, &50u32);
    let result =
        ts.client
            .try_submit_zk_proof(&60u32, &ts.player1, &valid_proof(&ts.env), &pi, &10u32);
    assert_error(&result, Error::AlreadySubmitted);
}

#[test]
fn test_cannot_submit_after_resolve() {
    let ts = setup();
    let hash = start(&ts, 61);
    let pi = treasure_hash_as_bytes(&ts.env, &hash);
    ts.client
        .submit_zk_proof(&61u32, &ts.player1, &valid_proof(&ts.env), &pi, &50u32);
    ts.client.resolve_game(&61u32);
    let result =
        ts.client
            .try_submit_zk_proof(&61u32, &ts.player2, &valid_proof(&ts.env), &pi, &50u32);
    assert_error(&result, Error::GameAlreadyResolved);
}

#[test]
fn test_resolve_before_any_submission_errors() {
    let ts = setup();
    start(&ts, 62);
    let result = ts.client.try_resolve_game(&62u32);
    assert_error(&result, Error::NeitherPlayerSubmitted);
}

// ============================================================================
// Idempotency
// ============================================================================

#[test]
fn test_resolve_is_idempotent() {
    let ts = setup();
    let hash = start(&ts, 70);
    let pi = treasure_hash_as_bytes(&ts.env, &hash);
    ts.client
        .submit_zk_proof(&70u32, &ts.player1, &valid_proof(&ts.env), &pi, &50u32);
    let first = ts.client.resolve_game(&70u32);
    let second = ts.client.resolve_game(&70u32);
    assert_eq!(first, second);
}

// ============================================================================
// Invalid Proof (Verifier Traps)
// ============================================================================

#[test]
#[should_panic(expected = "verify_proof: invalid proof")]
fn test_invalid_proof_traps_transaction() {
    let ts = setup();
    let hash = start(&ts, 80);
    let pi = treasure_hash_as_bytes(&ts.env, &hash);
    ts.client
        .submit_zk_proof(&80u32, &ts.player1, &invalid_proof(&ts.env), &pi, &50u32);
}

// ============================================================================
// Authorization
// ============================================================================

#[test]
fn test_non_player_cannot_submit() {
    let ts = setup();
    let hash = start(&ts, 90);
    let pi = treasure_hash_as_bytes(&ts.env, &hash);
    let outsider = Address::generate(&ts.env);
    let result =
        ts.client
            .try_submit_zk_proof(&90u32, &outsider, &valid_proof(&ts.env), &pi, &50u32);
    assert_error(&result, Error::NotPlayer);
}

#[test]
#[should_panic(expected = "Cannot play against yourself")]
fn test_self_play_rejected() {
    let ts = setup();
    ts.client.start_game(
        &99u32,
        &ts.player1,
        &ts.player1,
        &POINTS,
        &POINTS,
        &test_treasure_hash(&ts.env),
    );
}

// ============================================================================
// Multiple Independent Sessions
// ============================================================================

#[test]
fn test_multiple_sessions_independent() {
    let ts = setup();
    let p3 = Address::generate(&ts.env);
    let p4 = Address::generate(&ts.env);

    let h1 = BytesN::from_array(&ts.env, &[0x11u8; 32]);
    let h2 = BytesN::from_array(&ts.env, &[0x22u8; 32]);

    ts.client
        .start_game(&100u32, &ts.player1, &ts.player2, &POINTS, &POINTS, &h1);
    ts.client
        .start_game(&101u32, &p3, &p4, &POINTS, &POINTS, &h2);

    let pi1 = Bytes::from_array(&ts.env, &h1.to_array());
    let pi2 = Bytes::from_array(&ts.env, &h2.to_array());

    ts.client
        .submit_zk_proof(&100u32, &ts.player1, &valid_proof(&ts.env), &pi1, &10u32);
    ts.client
        .submit_zk_proof(&101u32, &p4, &valid_proof(&ts.env), &pi2, &5u32);

    assert_eq!(ts.client.resolve_game(&100u32), Outcome::Player1Won);
    assert_eq!(ts.client.resolve_game(&101u32), Outcome::Player2Won);
}

// ============================================================================
// Admin Functions
// ============================================================================

#[test]
fn test_verifier_stored_and_queryable() {
    let ts = setup();
    assert_eq!(ts.client.get_verifier(), ts.verifier_addr);
}

#[test]
fn test_admin_can_update_verifier() {
    let ts = setup();
    let new_ver = Address::generate(&ts.env);
    ts.client.set_verifier(&new_ver);
    assert_eq!(ts.client.get_verifier(), new_ver);
}

#[test]
fn test_upgrade_function_exists() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let hub = env.register(MockGameHub, ());
    let ver = env.register(MockVerifier, ());
    let cid = env.register(EatherGridContract, (&admin, &hub, &ver));
    let client = EatherGridContractClient::new(&env, &cid);
    // Upgrade will fail (no WASM with that hash) — that is expected.
    let result = client.try_upgrade(&BytesN::from_array(&env, &[1u8; 32]));
    assert!(result.is_err(), "upgrade with non-existent WASM must error");
}
