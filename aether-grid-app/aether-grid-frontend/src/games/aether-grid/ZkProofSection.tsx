import { useState, useRef, useCallback, useEffect } from 'react';
import { Buffer } from 'buffer';
import { zkLog } from './zkLogger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ZkProofResult {
  /** Raw UltraHonk proof — pass directly as `proof: Bytes` to the contract. */
  proofBytes: Buffer;
  /**
   * The Poseidon2 hash field extracted from the circuit's public outputs.
   * Must equal the `treasure_hash` stored on-chain (32 bytes).
   */
  publicInputsBuffer: Buffer;
}

export type ProofStatus =
  | 'idle'
  | 'initialising'
  | 'witness'
  | 'proving'
  | 'done'
  | 'error';

interface ZkProofSectionProps {
  /**
   * The 32-byte treasure hash stored on-chain for this session.
   * Passed as the `xy_nullifier_hashed` public input to the circuit.
   * Expected as a 0x-prefixed hex string or a 64-char hex string.
   */
  treasureHash: string;
  /**
   * The energy value collected from the board game (used for tiebreaking).
   * Injected by the parent so the user does not need to type it manually.
   */
  boardEnergy: number;
  /**
   * The treasure's X coordinate (integer). Injected by the parent after the
   * session is created — the player never types this manually.
   */
  x: number;
  /**
   * The treasure's Y coordinate (integer). Injected by the parent after the
   * session is created — the player never types this manually.
   */
  y: number;
  /**
   * The session-bound nullifier (integer). Derived by the parent from the
   * session ID at game-creation time and stored in state.
   */
  nullifier: number;
  /** If true, the component auto-starts proof generation on mount. */
  autoStart?: boolean;
  /** Called when a proof has been generated successfully. */
  onProofReady: (result: ZkProofResult) => void;
  /** Whether the parent is busy (e.g. submitting the proof). */
  disabled?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert a 0x-prefixed or raw hex string to a 32-byte Buffer. */
function hexTo32Bytes(hex: string): Buffer {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  return Buffer.from(clean.padStart(64, '0').slice(-64), 'hex');
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ZkProofSection({
  treasureHash,
  boardEnergy,
  x,
  y,
  nullifier,
  autoStart = false,
  onProofReady,
  disabled = false,
}: ZkProofSectionProps) {
  const [status, setStatus] = useState<ProofStatus>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);

  const handleGenerate = useCallback(async () => {
    setError(null);
    setStatus('initialising');
    setStatusMessage('Starting proof worker…');

    // Terminate any previous worker
    workerRef.current?.terminate();

    // Vite resolves `?worker` imports as Worker constructors automatically.
    const worker = new Worker(
      new URL('./zkProofWorker.ts', import.meta.url),
      { type: 'module' }
    );
    workerRef.current = worker;

    /**
     * The public input must be the same value that was committed to during
     * start_game as `treasure_hash`. We pass the hex representation of that
     * 32-byte value as a decimal field (BigInt conversion).
     */
    const hashHex = treasureHash.startsWith('0x')
      ? treasureHash.slice(2)
      : treasureHash;
    const hashDecimal = BigInt('0x' + hashHex.padStart(64, '0')).toString();

    // ── LOG: ZkProofSection — sending inputs to worker ──────────────────────
    zkLog.section('ZkProofSection · handleGenerate', {
      'x (treasure coord)':        Math.floor(x),
      'y (treasure coord)':        Math.floor(y),
      'nullifier (sessionId u32)': Math.floor(nullifier),
      'treasureHash (hex)':        '0x' + hashHex,
      'xy_nullifier_hashed (dec)': hashDecimal,
      'boardEnergy':               boardEnergy,
    });
    zkLog.end();
    // ────────────────────────────────────────────────────────────────────────

    worker.onmessage = (event) => {
      const data = event.data;

      if (data.type === 'STATUS') {
        const map: Record<string, ProofStatus> = {
          'Initialising': 'initialising',
          'Computing': 'witness',
          'Generating': 'proving',
        };
        const key = Object.keys(map).find(k => data.message.startsWith(k));
        if (key) setStatus(map[key]);
        setStatusMessage(data.message);
        zkLog.info('Worker·STATUS', data.message);
        return;
      }

      if (data.type === 'PROOF_READY') {
        setStatus('done');
        setStatusMessage('Proof generated!');
        worker.terminate();
        workerRef.current = null;

        const proofBytes = Buffer.from(data.proofBytes);

        /**
         * Proof splitting for Soroban:
         *
         * `publicInputs` is an array of hex strings — one per public field.
         * This circuit has exactly one public output: `xy_nullifier_hashed`.
         *
         * We convert it to a 32-byte Buffer and pass it as `public_inputs`
         * to `submit_zk_proof`. The contract will compare it byte-for-byte
         * against `game.treasure_hash`, so no parsing or field arithmetic
         * happens on-chain.
         */
        const pi = data.publicInputs[0] ?? '';
        const publicInputsBuffer = hexTo32Bytes(pi);

        // ── LOG: Proof ready — inspect before sending to contract ────────────
        zkLog.proofSummary('ZkProofSection·PROOF_READY', proofBytes, publicInputsBuffer);
        zkLog.info('ZkProofSection·PROOF_READY', 'publicInputs array from worker', data.publicInputs);
        zkLog.info('ZkProofSection·PROOF_READY', 'Calling onProofReady → handleSubmitProof will pick this up');
        // ────────────────────────────────────────────────────────────────────

        onProofReady({ proofBytes, publicInputsBuffer });
        return;
      }

      if (data.type === 'ERROR') {
        setStatus('error');
        setError(data.message);
        worker.terminate();
        workerRef.current = null;
        zkLog.error('Worker·ERROR', data.message);
      }
    };

    worker.onerror = (e) => {
      setStatus('error');
      setError(e.message);
      worker.terminate();
      workerRef.current = null;
      zkLog.error('Worker·onerror', 'Uncaught worker error', e);
    };

    worker.postMessage({
      type: 'GENERATE_PROOF',
      x: Math.floor(x).toString(),
      y: Math.floor(y).toString(),
      nullifier: Math.floor(nullifier).toString(),
      xy_nullifier_hashed: hashDecimal,
    });
  }, [x, y, nullifier, treasureHash, onProofReady]);

  // Auto-start proof generation when this component becomes active.
  useEffect(() => {
    if (autoStart && status === 'idle') {
      handleGenerate();
    }
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  const isGenerating =
    status === 'initialising' || status === 'witness' || status === 'proving';

  const statusColour =
    status === 'done'
      ? 'text-green-600'
      : status === 'error'
      ? 'text-red-600'
      : 'text-blue-600';

  const statusLabel: Record<ProofStatus, string> = {
    idle: 'Queued…',
    initialising: 'Initialising Barretenberg WASM…',
    witness: 'Computing witness…',
    proving: 'Generating UltraHonk proof… (10-30 s)',
    done: '✓ Proof generated successfully',
    error: 'Proof generation failed',
  };

  return (
    <div className="space-y-5">
      {/* Info banner */}
      <div className="p-3 bg-linear-to-r from-indigo-50 to-purple-50 border-2 border-indigo-200 rounded-xl">
        <p className="text-xs font-bold text-indigo-800 mb-1">🔐 Zero-Knowledge Proof</p>
        <p className="text-xs text-gray-700">
          Your coordinates stay private. The circuit proves you found
          the treasure without revealing X or Y to the contract.
        </p>
      </div>

      {/* Energy display (comes from board, not user-input) */}
      <div className="p-3 bg-linear-to-r from-amber-50 to-yellow-50 border-2 border-amber-200 rounded-xl flex items-center justify-between">
        <span className="text-xs font-bold text-amber-800">⚡ Energy Spent (from board)</span>
        <span className="text-sm font-mono font-bold text-amber-900">{boardEnergy}</span>
      </div>

      {/* Coordinate summary (read-only) */}
      <div className="p-3 bg-gradient-to-r from-slate-50 to-gray-50 border-2 border-slate-200 rounded-xl">
        <p className="text-xs font-bold text-slate-700 mb-2">📍 Treasure Location (private inputs)</p>
        <div className="grid grid-cols-3 gap-2 text-xs font-mono">
          <div className="text-center">
            <div className="text-slate-500">X</div>
            <div className="font-bold text-slate-800">{Math.floor(x)}</div>
          </div>
          <div className="text-center">
            <div className="text-slate-500">Y</div>
            <div className="font-bold text-slate-800">{Math.floor(y)}</div>
          </div>
          <div className="text-center">
            <div className="text-slate-500">Nullifier</div>
            <div className="font-bold text-slate-800 truncate">{Math.floor(nullifier)}</div>
          </div>
        </div>
        <p className="text-xs text-slate-400 mt-2 italic">
          These values are kept in-browser and never sent to the chain directly.
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 bg-red-50 border-2 border-red-200 rounded-xl">
          <p className="text-xs font-semibold text-red-700">{error}</p>
          <button
            onClick={handleGenerate}
            className="mt-2 text-xs underline text-red-600 hover:text-red-800"
          >
            Retry
          </button>
        </div>
      )}

      {/* Status */}
      <div className="flex items-center gap-3">
        {isGenerating && (
          <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
        )}
        <p className={`text-xs font-semibold ${statusColour}`}>
          {statusMessage || statusLabel[status]}
        </p>
      </div>

      {/* Hidden energy value readable by parent via DOM */}
      <input type="hidden" id="zk-energy-value" value={boardEnergy} />
    </div>
  );
}

/** Parse the hidden energy input from ZkProofSection inside the DOM. */
export function readEnergyUsed(): number {
  const el = document.getElementById('zk-energy-value') as HTMLInputElement | null;
  return el ? (parseInt(el.value) || 0) : 0;
}
