import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
// export * from "@stellar/stellar-sdk";
// export * as contract
// export * as rpc

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}





/**
 * Per-session game state stored in temporary storage.
 */
export interface Game {
  player1: string;
  /**
 * Energy spent by player 1 to reach the treasure; `None` if not yet submitted.
 */
player1_energy: Option<u32>;
  player1_points: i128;
  player2: string;
  /**
 * Energy spent by player 2 to reach the treasure; `None` if not yet submitted.
 */
player2_energy: Option<u32>;
  player2_points: i128;
  /**
 * True after `resolve_game` has been called.  Blocks late submissions.
 */
resolved: boolean;
  /**
 * Poseidon2(x, y, nullifier) — the expected public input for this session.
 * 
 * Set at `start_game` by the frontend (which knows the canonical treasure
 * coordinates and the session-specific nullifier).  Players must supply this
 * exact 32-byte value as `public_inputs` when calling `submit_zk_proof`.
 */
treasure_hash: Buffer;
}

export const Errors = {
  /**
   * No game exists for the given session ID.
   */
  1: {message:"GameNotFound"},
  /**
   * Caller is not player1 or player2 for this session.
   */
  2: {message:"NotPlayer"},
  /**
   * Player has already submitted a valid proof in this session.
   */
  3: {message:"AlreadySubmitted"},
  /**
   * `resolve_game` was called before any player submitted a proof.
   */
  4: {message:"NeitherPlayerSubmitted"},
  /**
   * The game has already been resolved; no further submissions accepted.
   */
  5: {message:"GameAlreadyResolved"},
  /**
   * `public_inputs` bytes do not match `game.treasure_hash`.
   * Prevents cross-session replay attacks.
   */
  6: {message:"PublicInputMismatch"}
}

/**
 * Storage keys.
 */
export type DataKey = {tag: "Game", values: readonly [u32]} | {tag: "GameHubAddress", values: void} | {tag: "VerifierAddress", values: void} | {tag: "Admin", values: void};

/**
 * Outcome returned by `resolve_game`.
 * 
 * Stored as a return value only — NOT stored inside `Game` to avoid nested
 * `#[contracttype]` enum serialisation issues with Soroban SDK.
 */
export type Outcome = {tag: "Player1Won", values: void} | {tag: "Player2Won", values: void} | {tag: "BothFoundTreasure", values: void} | {tag: "NeitherFound", values: void};

export interface Client {
  /**
   * Construct and simulate a get_hub transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_hub: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a set_hub transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_hub: ({new_hub}: {new_hub: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  upgrade: ({new_wasm_hash}: {new_wasm_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Retrieve full game state for a session.
   */
  get_game: ({session_id}: {session_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Game>>>

  /**
   * Construct and simulate a get_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_admin: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a set_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_admin: ({new_admin}: {new_admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a start_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Start a new game between two players.
   * 
   * The frontend must supply `treasure_hash` = `Poseidon2(x, y, nullifier)`
   * where `nullifier` is derived from session identity to prevent replay.
   * 
   * Recommended nullifier construction (off-chain):
   * `nullifier = keccak256(session_id_be ‖ player1_bytes ‖ player2_bytes)`
   * 
   * # Arguments
   * * `session_id`     – Unique session identifier (u32).
   * * `player1`        – First player's address.
   * * `player2`        – Second player's address.
   * * `player1_points` – Points committed by player 1.
   * * `player2_points` – Points committed by player 2.
   * * `treasure_hash`  – Poseidon2 hash of the session's canonical coordinates.
   */
  start_game: ({session_id, player1, player2, player1_points, player2_points, treasure_hash}: {session_id: u32, player1: string, player2: string, player1_points: i128, player2_points: i128, treasure_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_verifier transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_verifier: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a resolve_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Resolve the game and report the outcome to the Game Hub.
   * 
   * Can be called by anyone (permissionless).  Idempotent after first call.
   * Requires at least one player to have submitted a proof.
   * 
   * ## Winner Resolution
   * 
   * | p1_energy     | p2_energy     | Outcome            | GameHub            |
   * |---------------|---------------|--------------------|--------------------|
   * | Some(e1)      | None          | Player1Won         | player1_won = true |
   * | None          | Some(e2)      | Player2Won         | player1_won = false|
   * | Some(e1)      | Some(e2), e1 < e2 | Player1Won    | player1_won = true |
   * | Some(e1)      | Some(e2), e2 < e1 | Player2Won    | player1_won = false|
   * | Some(e1)      | Some(e2), e1 == e2 | BothFoundTreasure | player1_won = true |
   * | None          | None          | Error: NeitherPlayerSubmitted | – |
   * 
   * # Arguments
   * * `session_id` – The session to resolve.
   */
  resolve_game: ({session_id}: {session_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Outcome>>>

  /**
   * Construct and simulate a set_verifier transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Update the verifier contract address.
   * 
   * ⚠ Verifier Upgrade Warning: if the new verifier embeds a different VK,
   * all proofs generated against the old VK will fail.  Coordinate upgrades
   * carefully with all active players.
   */
  set_verifier: ({new_verifier}: {new_verifier: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a submit_zk_proof transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Submit a ZK proof of treasure discovery.
   * 
   * # Responsibilities
   * 1. Validates `public_inputs == game.treasure_hash` (opaque 32-byte
   * comparison — no byte slicing, no field parsing).
   * 2. Cross-contract call to the UltraHonk verifier.  If the proof is
   * invalid the verifier traps, reverting the entire transaction.
   * 3. Records `energy_used` for the player on success.
   * 
   * # Replay Protection
   * - `AlreadySubmitted` prevents a player from submitting twice.
   * - `PublicInputMismatch` blocks cross-session proof reuse because each
   * session's `treasure_hash` embeds a unique session-bound nullifier.
   * - `GameAlreadyResolved` blocks late submissions.
   * 
   * # Security Note (energy_used)
   * `energy_used` is a caller-supplied `u32` in this version.  A dishonest
   * player can underreport it.  Future circuit versions should include
   * `energy_used` as a verified public output of the Noir circuit.
   * 
   * # Arguments
   * * `session_id`    – Session being submitted to.
   * * `player`        – Submitting player (must be player1 or player2).
   * * `proof`         – Raw Ultr
   */
  submit_zk_proof: ({session_id, player, proof, public_inputs, energy_used}: {session_id: u32, player: string, proof: Buffer, public_inputs: Buffer, energy_used: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_treasure_hash transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Return the treasure hash (public input) for a session.
   * 
   * Frontends should use this as the `xy_nullifier_hashed` circuit input.
   */
  get_treasure_hash: ({session_id}: {session_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Buffer>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {admin, game_hub, verifier}: {admin: string, game_hub: string, verifier: string},
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy({admin, game_hub, verifier}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAQAAADNQZXItc2Vzc2lvbiBnYW1lIHN0YXRlIHN0b3JlZCBpbiB0ZW1wb3Jhcnkgc3RvcmFnZS4AAAAAAAAAAARHYW1lAAAACAAAAAAAAAAHcGxheWVyMQAAAAATAAAATEVuZXJneSBzcGVudCBieSBwbGF5ZXIgMSB0byByZWFjaCB0aGUgdHJlYXN1cmU7IGBOb25lYCBpZiBub3QgeWV0IHN1Ym1pdHRlZC4AAAAOcGxheWVyMV9lbmVyZ3kAAAAAA+gAAAAEAAAAAAAAAA5wbGF5ZXIxX3BvaW50cwAAAAAACwAAAAAAAAAHcGxheWVyMgAAAAATAAAATEVuZXJneSBzcGVudCBieSBwbGF5ZXIgMiB0byByZWFjaCB0aGUgdHJlYXN1cmU7IGBOb25lYCBpZiBub3QgeWV0IHN1Ym1pdHRlZC4AAAAOcGxheWVyMl9lbmVyZ3kAAAAAA+gAAAAEAAAAAAAAAA5wbGF5ZXIyX3BvaW50cwAAAAAACwAAAERUcnVlIGFmdGVyIGByZXNvbHZlX2dhbWVgIGhhcyBiZWVuIGNhbGxlZC4gIEJsb2NrcyBsYXRlIHN1Ym1pc3Npb25zLgAAAAhyZXNvbHZlZAAAAAEAAAElUG9zZWlkb24yKHgsIHksIG51bGxpZmllcikg4oCUIHRoZSBleHBlY3RlZCBwdWJsaWMgaW5wdXQgZm9yIHRoaXMgc2Vzc2lvbi4KClNldCBhdCBgc3RhcnRfZ2FtZWAgYnkgdGhlIGZyb250ZW5kICh3aGljaCBrbm93cyB0aGUgY2Fub25pY2FsIHRyZWFzdXJlCmNvb3JkaW5hdGVzIGFuZCB0aGUgc2Vzc2lvbi1zcGVjaWZpYyBudWxsaWZpZXIpLiAgUGxheWVycyBtdXN0IHN1cHBseSB0aGlzCmV4YWN0IDMyLWJ5dGUgdmFsdWUgYXMgYHB1YmxpY19pbnB1dHNgIHdoZW4gY2FsbGluZyBgc3VibWl0X3prX3Byb29mYC4AAAAAAAANdHJlYXN1cmVfaGFzaAAAAAAAA+4AAAAg",
        "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAABgAAAChObyBnYW1lIGV4aXN0cyBmb3IgdGhlIGdpdmVuIHNlc3Npb24gSUQuAAAADEdhbWVOb3RGb3VuZAAAAAEAAAAyQ2FsbGVyIGlzIG5vdCBwbGF5ZXIxIG9yIHBsYXllcjIgZm9yIHRoaXMgc2Vzc2lvbi4AAAAAAAlOb3RQbGF5ZXIAAAAAAAACAAAAO1BsYXllciBoYXMgYWxyZWFkeSBzdWJtaXR0ZWQgYSB2YWxpZCBwcm9vZiBpbiB0aGlzIHNlc3Npb24uAAAAABBBbHJlYWR5U3VibWl0dGVkAAAAAwAAAD5gcmVzb2x2ZV9nYW1lYCB3YXMgY2FsbGVkIGJlZm9yZSBhbnkgcGxheWVyIHN1Ym1pdHRlZCBhIHByb29mLgAAAAAAFk5laXRoZXJQbGF5ZXJTdWJtaXR0ZWQAAAAAAAQAAABEVGhlIGdhbWUgaGFzIGFscmVhZHkgYmVlbiByZXNvbHZlZDsgbm8gZnVydGhlciBzdWJtaXNzaW9ucyBhY2NlcHRlZC4AAAATR2FtZUFscmVhZHlSZXNvbHZlZAAAAAAFAAAAX2BwdWJsaWNfaW5wdXRzYCBieXRlcyBkbyBub3QgbWF0Y2ggYGdhbWUudHJlYXN1cmVfaGFzaGAuClByZXZlbnRzIGNyb3NzLXNlc3Npb24gcmVwbGF5IGF0dGFja3MuAAAAABNQdWJsaWNJbnB1dE1pc21hdGNoAAAAAAY=",
        "AAAAAgAAAA1TdG9yYWdlIGtleXMuAAAAAAAAAAAAAAdEYXRhS2V5AAAAAAQAAAABAAAAN1Blci1zZXNzaW9uIGdhbWUgc3RhdGUgKHRlbXBvcmFyeSBzdG9yYWdlLCAzMC1kYXkgVFRMKS4AAAAABEdhbWUAAAABAAAABAAAAAAAAAA5QWRkcmVzcyBvZiB0aGUgbW9jay1nYW1lLWh1YiBjb250cmFjdCAoaW5zdGFuY2Ugc3RvcmFnZSkuAAAAAAAADkdhbWVIdWJBZGRyZXNzAAAAAAAAAAAAPkFkZHJlc3Mgb2YgdGhlIFVsdHJhSG9uayB2ZXJpZmllciBjb250cmFjdCAoaW5zdGFuY2Ugc3RvcmFnZSkuAAAAAAAPVmVyaWZpZXJBZGRyZXNzAAAAAAAAAAAhQWRtaW4gYWRkcmVzcyAoaW5zdGFuY2Ugc3RvcmFnZSkuAAAAAAAABUFkbWluAAAA",
        "AAAAAgAAAK1PdXRjb21lIHJldHVybmVkIGJ5IGByZXNvbHZlX2dhbWVgLgoKU3RvcmVkIGFzIGEgcmV0dXJuIHZhbHVlIG9ubHkg4oCUIE5PVCBzdG9yZWQgaW5zaWRlIGBHYW1lYCB0byBhdm9pZCBuZXN0ZWQKYCNbY29udHJhY3R0eXBlXWAgZW51bSBzZXJpYWxpc2F0aW9uIGlzc3VlcyB3aXRoIFNvcm9iYW4gU0RLLgAAAAAAAAAAAAAHT3V0Y29tZQAAAAAEAAAAAAAAADxQbGF5ZXIgMSBmb3VuZCB0aGUgdHJlYXN1cmUgYW5kIHVzZWQgbGVzcyAob3IgZXF1YWwpIGVuZXJneS4AAAAKUGxheWVyMVdvbgAAAAAAAAAAADFQbGF5ZXIgMiBmb3VuZCB0aGUgdHJlYXN1cmUgYW5kIHVzZWQgbGVzcyBlbmVyZ3kuAAAAAAAAClBsYXllcjJXb24AAAAAAAAAAABYQm90aCBmb3VuZCB0aGUgdHJlYXN1cmUsIGJ1dCBuZWl0aGVyIHdpbnMgb3V0cmlnaHQgdmlhIGVuZXJneSAodGllIHJlc29sdmVkIHRvIFBsYXllcjEpLgAAABFCb3RoRm91bmRUcmVhc3VyZQAAAAAAAAAAAAAmTmVpdGhlciBwbGF5ZXIgcHJvdmlkZWQgYSB2YWxpZCBwcm9vZi4AAAAAAAxOZWl0aGVyRm91bmQ=",
        "AAAAAAAAAAAAAAAHZ2V0X2h1YgAAAAAAAAAAAQAAABM=",
        "AAAAAAAAAAAAAAAHc2V0X2h1YgAAAAABAAAAAAAAAAduZXdfaHViAAAAABMAAAAA",
        "AAAAAAAAAAAAAAAHdXBncmFkZQAAAAABAAAAAAAAAA1uZXdfd2FzbV9oYXNoAAAAAAAD7gAAACAAAAAA",
        "AAAAAAAAACdSZXRyaWV2ZSBmdWxsIGdhbWUgc3RhdGUgZm9yIGEgc2Vzc2lvbi4AAAAACGdldF9nYW1lAAAAAQAAAAAAAAAKc2Vzc2lvbl9pZAAAAAAABAAAAAEAAAPpAAAH0AAAAARHYW1lAAAAAw==",
        "AAAAAAAAAAAAAAAJZ2V0X2FkbWluAAAAAAAAAAAAAAEAAAAT",
        "AAAAAAAAAAAAAAAJc2V0X2FkbWluAAAAAAAAAQAAAAAAAAAJbmV3X2FkbWluAAAAAAAAEwAAAAA=",
        "AAAAAAAAAoxTdGFydCBhIG5ldyBnYW1lIGJldHdlZW4gdHdvIHBsYXllcnMuCgpUaGUgZnJvbnRlbmQgbXVzdCBzdXBwbHkgYHRyZWFzdXJlX2hhc2hgID0gYFBvc2VpZG9uMih4LCB5LCBudWxsaWZpZXIpYAp3aGVyZSBgbnVsbGlmaWVyYCBpcyBkZXJpdmVkIGZyb20gc2Vzc2lvbiBpZGVudGl0eSB0byBwcmV2ZW50IHJlcGxheS4KClJlY29tbWVuZGVkIG51bGxpZmllciBjb25zdHJ1Y3Rpb24gKG9mZi1jaGFpbik6CmBudWxsaWZpZXIgPSBrZWNjYWsyNTYoc2Vzc2lvbl9pZF9iZSDigJYgcGxheWVyMV9ieXRlcyDigJYgcGxheWVyMl9ieXRlcylgCgojIEFyZ3VtZW50cwoqIGBzZXNzaW9uX2lkYCAgICAg4oCTIFVuaXF1ZSBzZXNzaW9uIGlkZW50aWZpZXIgKHUzMikuCiogYHBsYXllcjFgICAgICAgICDigJMgRmlyc3QgcGxheWVyJ3MgYWRkcmVzcy4KKiBgcGxheWVyMmAgICAgICAgIOKAkyBTZWNvbmQgcGxheWVyJ3MgYWRkcmVzcy4KKiBgcGxheWVyMV9wb2ludHNgIOKAkyBQb2ludHMgY29tbWl0dGVkIGJ5IHBsYXllciAxLgoqIGBwbGF5ZXIyX3BvaW50c2Ag4oCTIFBvaW50cyBjb21taXR0ZWQgYnkgcGxheWVyIDIuCiogYHRyZWFzdXJlX2hhc2hgICDigJMgUG9zZWlkb24yIGhhc2ggb2YgdGhlIHNlc3Npb24ncyBjYW5vbmljYWwgY29vcmRpbmF0ZXMuAAAACnN0YXJ0X2dhbWUAAAAAAAYAAAAAAAAACnNlc3Npb25faWQAAAAAAAQAAAAAAAAAB3BsYXllcjEAAAAAEwAAAAAAAAAHcGxheWVyMgAAAAATAAAAAAAAAA5wbGF5ZXIxX3BvaW50cwAAAAAACwAAAAAAAAAOcGxheWVyMl9wb2ludHMAAAAAAAsAAAAAAAAADXRyZWFzdXJlX2hhc2gAAAAAAAPuAAAAIAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAMZ2V0X3ZlcmlmaWVyAAAAAAAAAAEAAAAT",
        "AAAAAAAAA2ZSZXNvbHZlIHRoZSBnYW1lIGFuZCByZXBvcnQgdGhlIG91dGNvbWUgdG8gdGhlIEdhbWUgSHViLgoKQ2FuIGJlIGNhbGxlZCBieSBhbnlvbmUgKHBlcm1pc3Npb25sZXNzKS4gIElkZW1wb3RlbnQgYWZ0ZXIgZmlyc3QgY2FsbC4KUmVxdWlyZXMgYXQgbGVhc3Qgb25lIHBsYXllciB0byBoYXZlIHN1Ym1pdHRlZCBhIHByb29mLgoKIyMgV2lubmVyIFJlc29sdXRpb24KCnwgcDFfZW5lcmd5ICAgICB8IHAyX2VuZXJneSAgICAgfCBPdXRjb21lICAgICAgICAgICAgfCBHYW1lSHViICAgICAgICAgICAgfAp8LS0tLS0tLS0tLS0tLS0tfC0tLS0tLS0tLS0tLS0tLXwtLS0tLS0tLS0tLS0tLS0tLS0tLXwtLS0tLS0tLS0tLS0tLS0tLS0tLXwKfCBTb21lKGUxKSAgICAgIHwgTm9uZSAgICAgICAgICB8IFBsYXllcjFXb24gICAgICAgICB8IHBsYXllcjFfd29uID0gdHJ1ZSB8CnwgTm9uZSAgICAgICAgICB8IFNvbWUoZTIpICAgICAgfCBQbGF5ZXIyV29uICAgICAgICAgfCBwbGF5ZXIxX3dvbiA9IGZhbHNlfAp8IFNvbWUoZTEpICAgICAgfCBTb21lKGUyKSwgZTEgPCBlMiB8IFBsYXllcjFXb24gICAgfCBwbGF5ZXIxX3dvbiA9IHRydWUgfAp8IFNvbWUoZTEpICAgICAgfCBTb21lKGUyKSwgZTIgPCBlMSB8IFBsYXllcjJXb24gICAgfCBwbGF5ZXIxX3dvbiA9IGZhbHNlfAp8IFNvbWUoZTEpICAgICAgfCBTb21lKGUyKSwgZTEgPT0gZTIgfCBCb3RoRm91bmRUcmVhc3VyZSB8IHBsYXllcjFfd29uID0gdHJ1ZSB8CnwgTm9uZSAgICAgICAgICB8IE5vbmUgICAgICAgICAgfCBFcnJvcjogTmVpdGhlclBsYXllclN1Ym1pdHRlZCB8IOKAkyB8CgojIEFyZ3VtZW50cwoqIGBzZXNzaW9uX2lkYCDigJMgVGhlIHNlc3Npb24gdG8gcmVzb2x2ZS4AAAAAAAxyZXNvbHZlX2dhbWUAAAABAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAQAAA+kAAAfQAAAAB091dGNvbWUAAAAAAw==",
        "AAAAAAAAANpVcGRhdGUgdGhlIHZlcmlmaWVyIGNvbnRyYWN0IGFkZHJlc3MuCgrimqAgVmVyaWZpZXIgVXBncmFkZSBXYXJuaW5nOiBpZiB0aGUgbmV3IHZlcmlmaWVyIGVtYmVkcyBhIGRpZmZlcmVudCBWSywKYWxsIHByb29mcyBnZW5lcmF0ZWQgYWdhaW5zdCB0aGUgb2xkIFZLIHdpbGwgZmFpbC4gIENvb3JkaW5hdGUgdXBncmFkZXMKY2FyZWZ1bGx5IHdpdGggYWxsIGFjdGl2ZSBwbGF5ZXJzLgAAAAAADHNldF92ZXJpZmllcgAAAAEAAAAAAAAADG5ld192ZXJpZmllcgAAABMAAAAA",
        "AAAAAAAAANpEZXBsb3kgYW5kIGNvbmZpZ3VyZSB0aGUgY29udHJhY3QuCgojIEFyZ3VtZW50cwoqIGBhZG1pbmAgICAg4oCTIEFkbWluIGFkZHJlc3MgKGBzZXRfKmAgKyBgdXBncmFkZWApLgoqIGBnYW1lX2h1YmAg4oCTIEFkZHJlc3Mgb2YgdGhlIG1vY2stZ2FtZS1odWIgY29udHJhY3QuCiogYHZlcmlmaWVyYCDigJMgQWRkcmVzcyBvZiB0aGUgZGVwbG95ZWQgVWx0cmFIb25rIHZlcmlmaWVyLgAAAAAADV9fY29uc3RydWN0b3IAAAAAAAADAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAACGdhbWVfaHViAAAAEwAAAAAAAAAIdmVyaWZpZXIAAAATAAAAAA==",
        "AAAAAAAABABTdWJtaXQgYSBaSyBwcm9vZiBvZiB0cmVhc3VyZSBkaXNjb3ZlcnkuCgojIFJlc3BvbnNpYmlsaXRpZXMKMS4gVmFsaWRhdGVzIGBwdWJsaWNfaW5wdXRzID09IGdhbWUudHJlYXN1cmVfaGFzaGAgKG9wYXF1ZSAzMi1ieXRlCmNvbXBhcmlzb24g4oCUIG5vIGJ5dGUgc2xpY2luZywgbm8gZmllbGQgcGFyc2luZykuCjIuIENyb3NzLWNvbnRyYWN0IGNhbGwgdG8gdGhlIFVsdHJhSG9uayB2ZXJpZmllci4gIElmIHRoZSBwcm9vZiBpcwppbnZhbGlkIHRoZSB2ZXJpZmllciB0cmFwcywgcmV2ZXJ0aW5nIHRoZSBlbnRpcmUgdHJhbnNhY3Rpb24uCjMuIFJlY29yZHMgYGVuZXJneV91c2VkYCBmb3IgdGhlIHBsYXllciBvbiBzdWNjZXNzLgoKIyBSZXBsYXkgUHJvdGVjdGlvbgotIGBBbHJlYWR5U3VibWl0dGVkYCBwcmV2ZW50cyBhIHBsYXllciBmcm9tIHN1Ym1pdHRpbmcgdHdpY2UuCi0gYFB1YmxpY0lucHV0TWlzbWF0Y2hgIGJsb2NrcyBjcm9zcy1zZXNzaW9uIHByb29mIHJldXNlIGJlY2F1c2UgZWFjaApzZXNzaW9uJ3MgYHRyZWFzdXJlX2hhc2hgIGVtYmVkcyBhIHVuaXF1ZSBzZXNzaW9uLWJvdW5kIG51bGxpZmllci4KLSBgR2FtZUFscmVhZHlSZXNvbHZlZGAgYmxvY2tzIGxhdGUgc3VibWlzc2lvbnMuCgojIFNlY3VyaXR5IE5vdGUgKGVuZXJneV91c2VkKQpgZW5lcmd5X3VzZWRgIGlzIGEgY2FsbGVyLXN1cHBsaWVkIGB1MzJgIGluIHRoaXMgdmVyc2lvbi4gIEEgZGlzaG9uZXN0CnBsYXllciBjYW4gdW5kZXJyZXBvcnQgaXQuICBGdXR1cmUgY2lyY3VpdCB2ZXJzaW9ucyBzaG91bGQgaW5jbHVkZQpgZW5lcmd5X3VzZWRgIGFzIGEgdmVyaWZpZWQgcHVibGljIG91dHB1dCBvZiB0aGUgTm9pciBjaXJjdWl0LgoKIyBBcmd1bWVudHMKKiBgc2Vzc2lvbl9pZGAgICAg4oCTIFNlc3Npb24gYmVpbmcgc3VibWl0dGVkIHRvLgoqIGBwbGF5ZXJgICAgICAgICDigJMgU3VibWl0dGluZyBwbGF5ZXIgKG11c3QgYmUgcGxheWVyMSBvciBwbGF5ZXIyKS4KKiBgcHJvb2ZgICAgICAgICAg4oCTIFJhdyBVbHRyAAAAD3N1Ym1pdF96a19wcm9vZgAAAAAFAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAAAAAAZwbGF5ZXIAAAAAABMAAAAAAAAABXByb29mAAAAAAAADgAAAAAAAAANcHVibGljX2lucHV0cwAAAAAAAA4AAAAAAAAAC2VuZXJneV91c2VkAAAAAAQAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAH1SZXR1cm4gdGhlIHRyZWFzdXJlIGhhc2ggKHB1YmxpYyBpbnB1dCkgZm9yIGEgc2Vzc2lvbi4KCkZyb250ZW5kcyBzaG91bGQgdXNlIHRoaXMgYXMgdGhlIGB4eV9udWxsaWZpZXJfaGFzaGVkYCBjaXJjdWl0IGlucHV0LgAAAAAAABFnZXRfdHJlYXN1cmVfaGFzaAAAAAAAAAEAAAAAAAAACnNlc3Npb25faWQAAAAAAAQAAAABAAAD6QAAA+4AAAAgAAAAAw==" ]),
      options
    )
  }
  public readonly fromJSON = {
    get_hub: this.txFromJSON<string>,
        set_hub: this.txFromJSON<null>,
        upgrade: this.txFromJSON<null>,
        get_game: this.txFromJSON<Result<Game>>,
        get_admin: this.txFromJSON<string>,
        set_admin: this.txFromJSON<null>,
        start_game: this.txFromJSON<Result<void>>,
        get_verifier: this.txFromJSON<string>,
        resolve_game: this.txFromJSON<Result<Outcome>>,
        set_verifier: this.txFromJSON<null>,
        submit_zk_proof: this.txFromJSON<Result<void>>,
        get_treasure_hash: this.txFromJSON<Result<Buffer>>
  }
}