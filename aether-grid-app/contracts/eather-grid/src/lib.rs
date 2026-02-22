#![no_std]

//! # Eather Grid Game — ZK Edition
//!
//! A two-player guessing game backed by a Zero-Knowledge equality circuit.
//!
//! ## Circuit
//! ```noir
//! fn main(x: Field, y: pub Field) { assert(x == y); }
//! ```
//! - `x` is the player's private guess.
//! - `y` is the session's public target, derived deterministically at game start.
//!
//! ## Flow
//! 1. Admin deploys the Verifier contract (UltraHonk, Keccak VK embedded).
//! 2. Admin deploys this contract, passing the Verifier contract ID.
//! 3. Caller invokes `start_game` → contract stores `target_public_inputs` derived
//!    from `keccak256(session_id ‖ player1 ‖ player2)`.
//! 4. Each player calls `submit_proof(session_id, proof, public_inputs)`.
//!    - Contract validates `public_inputs == game.target_public_inputs` to bind the
//!      session and prevent cross-session replay.
//!    - Contract calls `verifier.verify_proof(proof, public_inputs)` — traps on failure.
//! 5. Caller invokes `resolve_game` → outcome submitted to GameHub.
//!
//! ## Game Hub Integration
//! This contract is Game-Hub-aware. All sessions must be started/ended through it.
//!
//! ## Trust Boundaries
//! - Verifier contract is stateless and decoupled; its VK is baked in at deploy.
//! - Contract never inspects proof bytes or public_input bytes offsets.
//! - session_id → y binding is cryptographically enforced via keccak256.

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, vec, Address, Bytes,
    BytesN, Env, IntoVal,
};

// ============================================================================
// External Contract Interfaces
// ============================================================================

/// Interface for the mock-game-hub contract.
#[contractclient(name = "GameHubClient")]
pub trait GameHub {
    fn start_game(
        env: Env,
        game_id: Address,
        session_id: u32,
        player1: Address,
        player2: Address,
        player1_points: i128,
        player2_points: i128,
    );

    fn end_game(env: Env, session_id: u32, player1_won: bool);
}

/// Interface for the UltraHonk verifier contract.
///
/// The verifier is expected to **trap** (panic) if proof verification fails.
/// It MUST NOT return a boolean `false`; a passing call signals valid proof.
///
/// This trait is intentionally minimal and decoupled from any particular VK
/// or circuit. The VK is embedded in the deployed verifier WASM at compile time.
#[contractclient(name = "UltraHonkVerifierClient")]
pub trait UltraHonkVerifier {
    /// Verify a proof against the embedded VK.
    ///
    /// # Arguments
    /// * `proof`         - Raw proof bytes (opaque to this contract).
    /// * `public_inputs` - Public inputs bytes (opaque to this contract).
    ///
    /// # Panics
    /// Traps the transaction if verification fails. Never returns false.
    fn verify_proof(env: Env, proof: Bytes, public_inputs: Bytes);
}

// ============================================================================
// Errors
// ============================================================================

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// No game found for the given session ID.
    GameNotFound = 1,
    /// Caller is not a registered player in this session.
    NotPlayer = 2,
    /// Player already submitted a valid proof in this session.
    AlreadyVerified = 3,
    /// Resolve was called before at least one player attempted a proof.
    NeitherPlayerSubmitted = 4,
    /// The game session has already been resolved.
    GameAlreadyResolved = 5,
    /// `public_inputs` bytes do not match the session's target.
    /// This prevents cross-session replay attacks.
    PublicInputMismatch = 6,
}

// ============================================================================
// Data Types
// ============================================================================

/// Outcome returned from resolution.
///
/// This type is returned by `resolve_game` only; it is NOT stored inside `Game`
/// to avoid ScVal serialisation issues with nested #[contracttype] enums.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Outcome {
    /// Player 1 won.
    Player1Won,
    /// Player 2 won.
    Player2Won,
    /// Both players verified correctly.
    BothWon,
    /// Neither player verified correctly.
    NeitherWon,
}

/// Per-session game state stored in temporary storage.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Game {
    pub player1: Address,
    pub player2: Address,
    pub player1_points: i128,
    pub player2_points: i128,
    /// keccak256(session_id ‖ player1_bytes ‖ player2_bytes) — the expected
    /// public input `y` for this session.  Derived at `start_game` and stored
    /// so `submit_proof` can validate it without any byte-offset slicing.
    pub target_public_inputs: BytesN<32>,
    /// True once player 1 has submitted a proof that the verifier accepted.
    pub player1_verified: bool,
    /// True once player 2 has submitted a proof that the verifier accepted.
    pub player2_verified: bool,
    /// True after `resolve_game` has been called.  Prevents late submissions
    /// and makes resolution idempotent.
    pub resolved: bool,
}

/// Storage keys.
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Per-session game state (temporary storage).
    Game(u32),
    /// Address of the game hub contract (instance storage).
    GameHubAddress,
    /// Address of the UltraHonk verifier contract (instance storage).
    VerifierAddress,
    /// Admin address (instance storage).
    Admin,
}

// TTL constants
/// 30 days = 30 × 24 × 3600 / 5 ≈ 518 400 ledgers (5-second close).
const GAME_TTL_LEDGERS: u32 = 518_400;

// ============================================================================
// Contract
// ============================================================================

#[contract]
pub struct EatherGridContract;

#[contractimpl]
impl EatherGridContract {
    // ========================================================================
    // Lifecycle
    // ========================================================================

    /// Deploy and configure the contract.
    ///
    /// # Arguments
    /// * `admin`      - Admin address (may call `set_*` and `upgrade`).
    /// * `game_hub`   - Address of the mock-game-hub contract.
    /// * `verifier`   - Address of the deployed UltraHonk verifier contract.
    pub fn __constructor(env: Env, admin: Address, game_hub: Address, verifier: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::GameHubAddress, &game_hub);
        env.storage()
            .instance()
            .set(&DataKey::VerifierAddress, &verifier);
    }

    // ========================================================================
    // Game Flow
    // ========================================================================

    /// Start a new game between two players.
    ///
    /// Derives `target_public_inputs` = keccak256(session_id ‖ player1 ‖ player2).
    /// This value is the public input `y` that players must use when generating
    /// their Noir circuit proof.  By binding it to session identity, we guarantee:
    ///  - Each session has a unique `y` (no cross-session replay).
    ///  - The contract never needs to store an explicit secret.
    ///  - The frontend can reconstruct `y` deterministically without querying storage.
    ///
    /// # Arguments
    /// * `session_id`      - Unique session identifier.
    /// * `player1`         - Address of the first player.
    /// * `player2`         - Address of the second player.
    /// * `player1_points`  - Points committed by player 1.
    /// * `player2_points`  - Points committed by player 2.
    pub fn start_game(
        env: Env,
        session_id: u32,
        player1: Address,
        player2: Address,
        player1_points: i128,
        player2_points: i128,
    ) -> Result<(), Error> {
        if player1 == player2 {
            panic!("Cannot play against yourself");
        }

        // Require authorization from both players.
        player1.require_auth_for_args(vec![
            &env,
            session_id.into_val(&env),
            player1_points.into_val(&env),
        ]);
        player2.require_auth_for_args(vec![
            &env,
            session_id.into_val(&env),
            player2_points.into_val(&env),
        ]);

        // Derive target_public_inputs: keccak256(session_id ‖ player1 ‖ player2).
        //
        // This creates a session-unique 32-byte value that acts as the public
        // input `y` in the Noir circuit `assert(x == y)`.  The frontend must
        // use this exact 32-byte value when constructing the proof witness.
        //
        // Layout (no hardcoded slicing on-chain):
        //   [0..4)   – session_id as big-endian u32
        //   [4..N)   – player1 string bytes
        //   [N..M)   – player2 string bytes
        let session_id_bytes: [u8; 4] = session_id.to_be_bytes();
        let mut seed = Bytes::from_array(&env, &session_id_bytes);
        seed.append(&player1.to_string().to_bytes());
        seed.append(&player2.to_string().to_bytes());
        let target_public_inputs: BytesN<32> = env.crypto().keccak256(&seed).into();

        // Kick off the session in the Game Hub (locks points).
        let game_hub_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::GameHubAddress)
            .expect("GameHub not set");
        let game_hub = GameHubClient::new(&env, &game_hub_addr);
        game_hub.start_game(
            &env.current_contract_address(),
            &session_id,
            &player1,
            &player2,
            &player1_points,
            &player2_points,
        );

        // Persist the game state.
        let game = Game {
            player1,
            player2,
            player1_points,
            player2_points,
            target_public_inputs,
            player1_verified: false,
            player2_verified: false,
            resolved: false,
        };

        let key = DataKey::Game(session_id);
        env.storage().temporary().set(&key, &game);
        env.storage()
            .temporary()
            .extend_ttl(&key, GAME_TTL_LEDGERS, GAME_TTL_LEDGERS);

        Ok(())
    }

    /// Submit a ZK proof for the given session.
    ///
    /// The contract:
    /// 1. Validates that `public_inputs` bytes equal `game.target_public_inputs`.
    ///    — This is the only on-chain binding between session and proof; no byte
    ///      slicing or field parsing occurs here.
    /// 2. Calls `verifier.verify_proof(proof, public_inputs)` via the generated
    ///    client.  If the verifier traps, the entire transaction reverts.
    /// 3. Marks the player as having successfully verified.
    ///
    /// Replay protection:
    /// - A player who already verified cannot submit again (`AlreadyVerified`).
    /// - `public_inputs` must exactly equal the session-derived target, blocking
    ///   proofs copied from another session.
    ///
    /// Late submissions:
    /// - `submit_proof` is rejected after `resolve_game` has been called.
    ///
    /// # Arguments
    /// * `session_id`    - The session to submit against.
    /// * `player`        - The submitting player's address (must be p1 or p2).
    /// * `proof`         - Raw proof bytes (UltraHonk format).
    /// * `public_inputs` - Public inputs bytes — must equal `target_public_inputs`.
    pub fn submit_proof(
        env: Env,
        session_id: u32,
        player: Address,
        proof: Bytes,
        public_inputs: Bytes,
    ) -> Result<(), Error> {
        player.require_auth();

        let key = DataKey::Game(session_id);
        let mut game: Game = env
            .storage()
            .temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)?;

        // Reject late submissions.
        if game.resolved {
            return Err(Error::GameAlreadyResolved);
        }

        // Determine which player is submitting and guard against duplicates.
        let is_player1 = player == game.player1;
        let is_player2 = player == game.player2;

        if !is_player1 && !is_player2 {
            return Err(Error::NotPlayer);
        }
        if is_player1 && game.player1_verified {
            return Err(Error::AlreadyVerified);
        }
        if is_player2 && game.player2_verified {
            return Err(Error::AlreadyVerified);
        }

        // Validate public_inputs against the session-specific target.
        //
        // We compare the raw Bytes representation of the 32-byte keccak hash
        // to the caller-supplied public_inputs.  This is the sole binding
        // between the session and the proof — no slicing, no field parsing.
        let expected = Bytes::from_array(&env, &game.target_public_inputs.to_array());
        if public_inputs != expected {
            return Err(Error::PublicInputMismatch);
        }

        // Cross-contract call to the decoupled, stateless verifier.
        // If verification fails, the verifier traps → entire tx reverts.
        let verifier_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::VerifierAddress)
            .expect("Verifier not set");
        let verifier = UltraHonkVerifierClient::new(&env, &verifier_addr);
        verifier.verify_proof(&proof, &public_inputs);

        // Verification passed — mark the player.
        if is_player1 {
            game.player1_verified = true;
        } else {
            game.player2_verified = true;
        }
        env.storage().temporary().set(&key, &game);
        env.storage()
            .temporary()
            .extend_ttl(&key, GAME_TTL_LEDGERS, GAME_TTL_LEDGERS);

        Ok(())
    }

    /// Resolve the game and report the outcome to the Game Hub.
    ///
    /// Can be called by anyone (permissionless resolution).  The game must not
    /// have been resolved yet, and at least one player must have attempted to
    /// submit a proof (so the game is not trivially in its initial state).
    ///
    /// Outcome rules:
    /// | player1_verified | player2_verified | Outcome       | GameHub call        |
    /// |------------------|------------------|---------------|---------------------|
    /// | true             | false            | Player1Won    | player1_won = true  |
    /// | false            | true             | Player2Won    | player1_won = false |
    /// | true             | true             | BothWon       | player1_won = true  |
    /// | false            | false            | NeitherWon    | player1_won = false |
    ///
    /// Note: GameHub only accepts a single boolean winner.  BothWon defaults to
    /// player1 being reported as the winner; NeitherWon reports player2.
    /// These semantics can be revisited when GameHub gains richer outcome support.
    ///
    /// # Arguments
    /// * `session_id` - The session to resolve.
    pub fn resolve_game(env: Env, session_id: u32) -> Result<Outcome, Error> {
        let key = DataKey::Game(session_id);
        let mut game: Game = env
            .storage()
            .temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)?;

        // Idempotent: recompute and return outcome without re-resolving.
        if game.resolved {
            let outcome = match (game.player1_verified, game.player2_verified) {
                (true, false) => Outcome::Player1Won,
                (false, true) => Outcome::Player2Won,
                (true, true) => Outcome::BothWon,
                (false, false) => Outcome::NeitherWon,
            };
            return Ok(outcome);
        }

        // Require at least one player to have submitted before resolving.
        if !game.player1_verified && !game.player2_verified {
            return Err(Error::NeitherPlayerSubmitted);
        }

        // Determine outcome from verification flags.
        let outcome = match (game.player1_verified, game.player2_verified) {
            (true, false) => Outcome::Player1Won,
            (false, true) => Outcome::Player2Won,
            (true, true) => Outcome::BothWon,
            (false, false) => Outcome::NeitherWon, // guarded above; unreachable in practice
        };

        // Map outcome → GameHub boolean.
        let player1_won = matches!(outcome, Outcome::Player1Won | Outcome::BothWon);

        // Mark as resolved.
        game.resolved = true;
        env.storage().temporary().set(&key, &game);

        // Notify Game Hub.
        let game_hub_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::GameHubAddress)
            .expect("GameHub not set");
        let game_hub = GameHubClient::new(&env, &game_hub_addr);
        game_hub.end_game(&session_id, &player1_won);

        Ok(outcome)
    }

    // ========================================================================
    // Queries
    // ========================================================================

    /// Retrieve game state for a session.
    pub fn get_game(env: Env, session_id: u32) -> Result<Game, Error> {
        env.storage()
            .temporary()
            .get(&DataKey::Game(session_id))
            .ok_or(Error::GameNotFound)
    }

    /// Return the target public inputs (32 bytes) for a session.
    ///
    /// Frontends MUST use this value as the public input `y` when generating
    /// proofs.  Parsing the Noir ABI is unnecessary for `y` — this is the
    /// canonical source of truth.
    pub fn get_target(env: Env, session_id: u32) -> Result<BytesN<32>, Error> {
        let game: Game = env
            .storage()
            .temporary()
            .get(&DataKey::Game(session_id))
            .ok_or(Error::GameNotFound)?;
        Ok(game.target_public_inputs)
    }

    // ========================================================================
    // Admin Functions
    // ========================================================================

    /// Return the admin address.
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set")
    }

    /// Transfer admin to a new address (requires current admin auth).
    pub fn set_admin(env: Env, new_admin: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
    }

    /// Return the Game Hub address.
    pub fn get_hub(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::GameHubAddress)
            .expect("GameHub not set")
    }

    /// Update the Game Hub address (requires admin auth).
    pub fn set_hub(env: Env, new_hub: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::GameHubAddress, &new_hub);
    }

    /// Return the Verifier contract address (stored in INSTANCE storage).
    pub fn get_verifier(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::VerifierAddress)
            .expect("Verifier not set")
    }

    /// Update the Verifier contract address (requires admin auth).
    ///
    /// Verifier upgrades are handled by deploying a new verifier contract
    /// and calling this function.  Active sessions are not affected; they will
    /// use the new verifier for any *subsequent* `submit_proof` calls.
    ///
    /// # Verifier Upgrade Edge Case
    /// If a new verifier uses a different VK, proofs generated against the
    /// old VK will fail verification.  Coordinate upgrades with players.
    pub fn set_verifier(env: Env, new_verifier: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::VerifierAddress, &new_verifier);
    }

    /// Upgrade the contract WASM (requires admin auth).
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        admin.require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod test;
