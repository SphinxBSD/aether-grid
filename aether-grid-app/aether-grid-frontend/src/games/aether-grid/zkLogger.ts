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
};
