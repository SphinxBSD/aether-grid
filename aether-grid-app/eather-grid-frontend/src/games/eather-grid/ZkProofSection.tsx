import { useState, useRef, useCallback } from 'react';
import { Buffer } from 'buffer';

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

/** Sanitise a numeric field input for the Noir circuit. */
function sanitiseField(raw: string): string {
  const trimmed = raw.trim();
  // Accept decimal integers or 0x-prefixed hex — pass through as-is.
  return trimmed;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ZkProofSection({
  treasureHash,
  onProofReady,
  disabled = false,
}: ZkProofSectionProps) {
  const [x, setX] = useState('');
  const [y, setY] = useState('');
  const [nullifier, setNullifier] = useState('');
  const [energyUsed, setEnergyUsed] = useState('');
  const [status, setStatus] = useState<ProofStatus>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);

  const handleGenerate = useCallback(async () => {
    if (!x.trim() || !y.trim() || !nullifier.trim()) {
      setError('Please fill in the X, Y, and Nullifier fields.');
      return;
    }

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

        onProofReady({ proofBytes, publicInputsBuffer });
        return;
      }

      if (data.type === 'ERROR') {
        setStatus('error');
        setError(data.message);
        worker.terminate();
        workerRef.current = null;
      }
    };

    worker.onerror = (e) => {
      setStatus('error');
      setError(e.message);
      worker.terminate();
      workerRef.current = null;
    };

    worker.postMessage({
      type: 'GENERATE_PROOF',
      x: sanitiseField(x),
      y: sanitiseField(y),
      nullifier: sanitiseField(nullifier),
      xy_nullifier_hashed: hashDecimal,
    });
  }, [x, y, nullifier, treasureHash, onProofReady]);

  const isGenerating =
    status === 'initialising' || status === 'witness' || status === 'proving';

  const statusColour =
    status === 'done'
      ? 'text-green-600'
      : status === 'error'
      ? 'text-red-600'
      : 'text-blue-600';

  const statusLabel: Record<ProofStatus, string> = {
    idle: '',
    initialising: 'Initialising Barretenberg WASM…',
    witness: 'Computing witness…',
    proving: 'Generating UltraHonk proof… (10-30 s)',
    done: '✓ Proof generated successfully',
    error: 'Proof generation failed',
  };

  return (
    <div className="space-y-5">
      {/* Info banner */}
      <div className="p-3 bg-gradient-to-r from-indigo-50 to-purple-50 border-2 border-indigo-200 rounded-xl">
        <p className="text-xs font-bold text-indigo-800 mb-1">🔐 Zero-Knowledge Proof</p>
        <p className="text-xs text-gray-700">
          Your coordinates stay private. The circuit proves you know
          them without revealing X or Y to the contract.
        </p>
      </div>

      {/* Input fields */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-bold text-gray-700 mb-1">
            X Coordinate <span className="text-red-500">*</span>
          </label>
          <input
            id="zk-input-x"
            type="text"
            value={x}
            onChange={(e) => setX(e.target.value)}
            placeholder="e.g. 3"
            disabled={isGenerating || disabled}
            className="w-full px-3 py-2 rounded-xl bg-white border-2 border-gray-200 focus:outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 text-sm font-mono disabled:bg-gray-50 disabled:cursor-not-allowed"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-700 mb-1">
            Y Coordinate <span className="text-red-500">*</span>
          </label>
          <input
            id="zk-input-y"
            type="text"
            value={y}
            onChange={(e) => setY(e.target.value)}
            placeholder="e.g. 5"
            disabled={isGenerating || disabled}
            className="w-full px-3 py-2 rounded-xl bg-white border-2 border-gray-200 focus:outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 text-sm font-mono disabled:bg-gray-50 disabled:cursor-not-allowed"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-bold text-gray-700 mb-1">
          Nullifier <span className="text-red-500">*</span>
        </label>
        <input
          id="zk-input-nullifier"
          type="text"
          value={nullifier}
          onChange={(e) => setNullifier(e.target.value)}
          placeholder="Session-bound nullifier (decimal or 0x hex)"
          disabled={isGenerating || disabled}
          className="w-full px-3 py-2 rounded-xl bg-white border-2 border-gray-200 focus:outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 text-sm font-mono disabled:bg-gray-50 disabled:cursor-not-allowed"
        />
        <p className="text-xs text-gray-500 mt-1 font-semibold">
          Derive as: keccak256(session_id_be ‖ player1_bytes ‖ player2_bytes)
        </p>
      </div>

      <div>
        <label className="block text-xs font-bold text-gray-700 mb-1">
          Energy Used
        </label>
        <input
          id="zk-input-energy"
          type="number"
          min="0"
          value={energyUsed}
          onChange={(e) => setEnergyUsed(e.target.value)}
          placeholder="e.g. 42"
          disabled={isGenerating || disabled}
          className="w-full px-3 py-2 rounded-xl bg-white border-2 border-gray-200 focus:outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 text-sm font-mono disabled:bg-gray-50 disabled:cursor-not-allowed"
        />
        <p className="text-xs text-gray-500 mt-1 font-semibold">
          Lower energy wins tiebreaker. Caller-supplied (not circuit-constrained yet).
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 bg-red-50 border-2 border-red-200 rounded-xl">
          <p className="text-xs font-semibold text-red-700">{error}</p>
        </div>
      )}

      {/* Status */}
      {status !== 'idle' && (
        <div className="flex items-center gap-3">
          {isGenerating && (
            <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
          )}
          <p className={`text-xs font-semibold ${statusColour}`}>
            {statusMessage || statusLabel[status]}
          </p>
        </div>
      )}

      {/* Action button */}
      <button
        id="zk-generate-btn"
        onClick={handleGenerate}
        disabled={isGenerating || disabled || status === 'done'}
        className="w-full py-4 rounded-xl font-bold text-white text-sm bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 hover:from-indigo-600 hover:via-purple-600 hover:to-pink-600 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500 transition-all shadow-lg hover:shadow-xl transform hover:scale-105 disabled:transform-none"
      >
        {isGenerating
          ? '⏳ Generating Proof…'
          : status === 'done'
          ? '✓ Proof Ready'
          : '🔐 Generate ZK Proof'}
      </button>

      {/* Expose energyUsed for parent — hidden but accessible via prop callback */}
      {/* The parent reads energyUsed from the ZkProofResult callback.
          We attach it here so the parent doesn't need its own state. */}
      <input type="hidden" id="zk-energy-value" value={energyUsed} />
    </div>
  );
}

/** Parse the hidden energy input from ZkProofSection inside the DOM. */
export function readEnergyUsed(): number {
  const el = document.getElementById('zk-energy-value') as HTMLInputElement | null;
  return el ? (parseInt(el.value) || 0) : 0;
}
