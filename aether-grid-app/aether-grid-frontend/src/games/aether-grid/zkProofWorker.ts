/**
 * ZK Proof Worker
 *
 * This Web Worker handles UltraHonk proof generation using @noir-lang/noir_js
 * and @aztec/bb.js off the main thread so the UI never freezes.
 *
 * Security note: private inputs (x, y, nullifier) are passed via postMessage
 * which is an in-process structured-clone — they never leave the browser tab
 * and are never logged or serialised into the transaction.
 */

import { UltraHonkBackend } from '@aztec/bb.js';
import { Noir } from '@noir-lang/noir_js';
// The compiled Noir circuit artifact — bytecode is loaded from this JSON.
import circuit from '../../zkbytecode/map_1.json';

export type WorkerRequest = {
  type: 'GENERATE_PROOF';
  /** Private input: x coordinate (decimal string or number) */
  x: string;
  /** Private input: y coordinate (decimal string or number) */
  y: string;
  /** Private input: session-bound nullifier (hex string or decimal) */
  nullifier: string;
  /** Public input: Poseidon2(x,y,nullifier) — must match game.treasure_hash */
  xy_nullifier_hashed: string;
};

export type WorkerResponse =
  | {
      type: 'PROOF_READY';
      /** Raw UltraHonk proof as a plain byte array (transferable) */
      proofBytes: number[];
      /**
       * Public inputs as returned by Barretenberg.
       * For this circuit there is exactly one: the Poseidon2 hash field.
       * Each entry is a 0x-prefixed hex string.
       */
      publicInputs: string[];
    }
  | {
      type: 'ERROR';
      message: string;
    }
  | {
      type: 'STATUS';
      message: string;
    };

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { type, x, y, nullifier, xy_nullifier_hashed } = event.data;

  if (type !== 'GENERATE_PROOF') return;

  const post = (msg: WorkerResponse) => self.postMessage(msg);

  try {
    post({ type: 'STATUS', message: 'Initialising Barretenberg WASM…' });

    // Use hardware concurrency for multi-threading; fall back to 1 thread.
    const threads = (navigator as any).hardwareConcurrency || 1;

    /**
     * In @aztec/bb.js 0.87.0, UltraHonkBackend manages the Barretenberg
     * instance internally.  You pass `backendOptions` (including threads)
     * as the second constructor argument.
     */
    const honk = new UltraHonkBackend(circuit.bytecode, { threads });
    const noir = new Noir(circuit as any);

    post({ type: 'STATUS', message: 'Computing witness…' });

    const { witness } = await noir.execute({
      x,
      y,
      nullifier,
      xy_nullifier_hashed,
    });

    post({ type: 'STATUS', message: 'Generating UltraHonk proof… (this may take 10-30 s)' });

    /**
     * IMPORTANT: pass `{ keccak: true }` to match the on-chain Soroban verifier,
     * which uses Keccak-256 for Fiat-Shamir transcript hashing.
     * Without this flag, Barretenberg uses Poseidon for challenges, producing
     * a proof that the Keccak-based verifier will reject (VerificationFailed).
     *
     * Do NOT pass `{ verifierTarget: 'evm' }` — that changes the proof layout
     * by prepending a 4-byte function selector and encodes public inputs
     * differently, which is not what the Soroban verifier expects.
     */
    const { proof, publicInputs } = await honk.generateProof(witness, { keccak: true });

    // Destroy the backend to free WASM memory
    await honk.destroy();

    post({
      type: 'PROOF_READY',
      proofBytes: Array.from(proof),
      publicInputs,
    });
  } catch (err: any) {
    post({ type: 'ERROR', message: err?.message ?? String(err) });
  }
};
