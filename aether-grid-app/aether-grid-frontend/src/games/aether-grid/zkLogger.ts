/**
 * ╔══════════════════════════════════════════════════════╗
 * ║           ZK PROOF DEBUG LOGGER                      ║
 * ║  All logs are grouped and color-coded in DevTools.   ║
 * ║  Filter by "[ZK]" in the console to isolate them.   ║
 * ╚══════════════════════════════════════════════════════╝
 *
 * Usage:
 *   import { zkLog } from './zkLogger';
 *   zkLog.section('Prepare Game', { sessionId, treasureX: x, ... });
 */

const STYLES = {
  section:  'color: #a78bfa; font-weight: bold; font-size: 13px;',
  info:     'color: #60a5fa; font-weight: bold;',
  success:  'color: #34d399; font-weight: bold;',
  warn:     'color: #fbbf24; font-weight: bold;',
  error:    'color: #f87171; font-weight: bold;',
  data:     'color: #94a3b8;',
};

function prefix(tag: string) {
  return `%c[ZK] [${tag}]`;
}

export const zkLog = {
  /**
   * Opens a collapsible console group for a major step.
   * Call zkLog.end() to close it.
   */
  section(title: string, data?: Record<string, unknown>) {
    console.groupCollapsed(`%c[ZK] ══ ${title} ══`, STYLES.section);
    if (data) {
      console.log('%cInputs / State:', STYLES.data, data);
    }
  },

  end() {
    console.groupEnd();
  },

  info(tag: string, message: string, data?: unknown) {
    if (data !== undefined) {
      console.log(prefix(tag), STYLES.info, message, data);
    } else {
      console.log(prefix(tag), STYLES.info, message);
    }
  },

  success(tag: string, message: string, data?: unknown) {
    if (data !== undefined) {
      console.log(prefix(tag), STYLES.success, `✅ ${message}`, data);
    } else {
      console.log(prefix(tag), STYLES.success, `✅ ${message}`);
    }
  },

  warn(tag: string, message: string, data?: unknown) {
    if (data !== undefined) {
      console.warn(prefix(tag), STYLES.warn, `⚠️  ${message}`, data);
    } else {
      console.warn(prefix(tag), STYLES.warn, `⚠️  ${message}`);
    }
  },

  error(tag: string, message: string, err?: unknown) {
    console.error(prefix(tag), STYLES.error, `❌ ${message}`, err ?? '');
  },

  /**
   * Logs a Buffer or Uint8Array as hex for easy inspection.
   */
  hex(tag: string, label: string, buf: ArrayLike<number>) {
    const hex = Array.from(buf as Uint8Array)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    console.log(prefix(tag), STYLES.data, `${label}: 0x${hex} (${(buf as Uint8Array).length ?? (buf as any).length} bytes)`);
  },

  /**
   * Logs proof & public inputs summary for quick verification.
   */
  proofSummary(tag: string, proofBytes: ArrayLike<number>, publicInputsBuffer: ArrayLike<number>) {
    const proofArr = Array.from(proofBytes as Uint8Array);
    const piArr    = Array.from(publicInputsBuffer as Uint8Array);
    const proofHex = proofArr.map(b => b.toString(16).padStart(2, '0')).join('');
    const piHex    = piArr.map(b => b.toString(16).padStart(2, '0')).join('');

    console.groupCollapsed(`%c[ZK] [${tag}] Proof summary`, STYLES.success);
    console.log('%cProof length (bytes):', STYLES.data, proofArr.length);
    console.log('%cProof (first 64 hex chars):', STYLES.data, '0x' + proofHex.slice(0, 64) + '…');
    console.log('%cPublic inputs (hex):', STYLES.data, '0x' + piHex);
    console.groupEnd();
  },

  /**
   * Logs a structured "snapshot" of all circuit inputs at a specific moment.
   * Used to record what was committed at game-start and what the circuit received.
   *
   * @param tag     Log tag (e.g. 'Game·Start', 'ZkProofSection·Send')
   * @param inputs  Private inputs: x, y, nullifier
   * @param hashHex 64-char hex string — the expected public input (treasure_hash)
   * @param context Optional extra context (sessionId, phase, etc.)
   */
  snapshot(
    tag: string,
    inputs: { x: number | string; y: number | string; nullifier: number | string },
    hashHex: string,
    context?: Record<string, unknown>,
  ) {
    const clean = hashHex.startsWith('0x') ? hashHex.slice(2) : hashHex;
    console.groupCollapsed(`%c[ZK] [${tag}] 📸 Input Snapshot`, STYLES.section);
    console.log('%c── Private inputs (never leave the browser) ──', STYLES.data);
    console.log('%c  x         :', STYLES.data, inputs.x);
    console.log('%c  y         :', STYLES.data, inputs.y);
    console.log('%c  nullifier :', STYLES.data, inputs.nullifier);
    console.log('%c── Public input (committed on-chain as treasure_hash) ──', STYLES.data);
    console.log('%c  hex :', STYLES.data, '0x' + clean);
    console.log('%c  dec :', STYLES.data, BigInt('0x' + clean.padStart(64, '0')).toString());
    if (context) {
      console.log('%c── Context ──', STYLES.data);
      console.log('%c', STYLES.data, context);
    }
    console.groupEnd();
  },

  /**
   * Side-by-side comparison of two hex values with a clear MATCH / MISMATCH verdict.
   *
   * The critical invariant for a successful ZK proof submission is:
   *   pedersen_hash(x, y, nullifier) computed at game-start
   *   === publicInputs[0] returned by the Noir circuit
   *   === treasure_hash stored on-chain
   *
   * @param tag      Log tag
   * @param label    Short description of what is being compared
   * @param expected The value committed on-chain (treasureHashHex, game-start)
   * @param received The value output by the circuit (publicInputsBuffer hex, proof-end)
   */
  compare(tag: string, label: string, expected: string, received: string) {
    const clean = (h: string) => (h.startsWith('0x') ? h.slice(2) : h).toLowerCase().padStart(64, '0');
    const exp = clean(expected);
    const rec = clean(received);
    const match = exp === rec;

    if (match) {
      console.groupCollapsed(`%c[ZK] [${tag}] ✅ MATCH — ${label}`, STYLES.success);
    } else {
      console.groupCollapsed(`%c[ZK] [${tag}] ❌ MISMATCH — ${label}`, STYLES.error);
    }
    console.log('%c  expected (on-chain / committed at game-start):', STYLES.data, '0x' + exp);
    console.log('%c  received (circuit public output from proof)   :', STYLES.data, '0x' + rec);

    if (!match) {
      // Find first differing nibble for quick diagnosis
      let firstDiff = -1;
      for (let i = 0; i < Math.max(exp.length, rec.length); i++) {
        if ((exp[i] ?? '?') !== (rec[i] ?? '?')) { firstDiff = i; break; }
      }
      console.error('%c  ⚠ First difference at nibble index:', STYLES.error, firstDiff);
      console.error('%c  Possible causes:', STYLES.error);
      console.error('%c    1) Different hash function (Poseidon2 vs Pedersen)', STYLES.error);
      console.error('%c    2) Wrong inputs (x / y / nullifier mismatch)', STYLES.error);
      console.error('%c    3) Wrong hashIndex in pedersenHash() — must be 0', STYLES.error);
      console.error('%c    4) Stale treasureHashHex state (loaded from chain vs. freshly computed)', STYLES.error);
    }
    console.groupEnd();
  },
};
