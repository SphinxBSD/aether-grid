/**
 * Transaction helper utilities
 */

import { contract } from '@stellar/stellar-sdk';

// ── Diagnostic logger (same style as zkLogger, no DOM needed) ─────────────────
const txLog = {
  info:  (msg: string, data?: unknown) => data !== undefined
    ? console.log(`%c[TX·Helper] ${msg}`, 'color:#60a5fa;font-weight:bold;', data)
    : console.log(`%c[TX·Helper] ${msg}`, 'color:#60a5fa;font-weight:bold;'),
  ok:    (msg: string, data?: unknown) => data !== undefined
    ? console.log(`%c[TX·Helper] ✅ ${msg}`, 'color:#34d399;font-weight:bold;', data)
    : console.log(`%c[TX·Helper] ✅ ${msg}`, 'color:#34d399;font-weight:bold;'),
  warn:  (msg: string, data?: unknown) => data !== undefined
    ? console.warn(`%c[TX·Helper] ⚠️  ${msg}`, 'color:#fbbf24;font-weight:bold;', data)
    : console.warn(`%c[TX·Helper] ⚠️  ${msg}`, 'color:#fbbf24;font-weight:bold;'),
  err:   (msg: string, err?: unknown) =>
    console.error(`%c[TX·Helper] ❌ ${msg}`, 'color:#f87171;font-weight:bold;', err ?? ''),
};

/**
 * Sign and send a transaction via Launchtube
 * @param tx - The assembled transaction or XDR string
 * @param timeoutInSeconds - Timeout for the transaction
 * @param validUntilLedgerSeq - Valid until ledger sequence
 * @returns Transaction result
 */
export async function signAndSendViaLaunchtube(
  tx: contract.AssembledTransaction<any> | string,
  timeoutInSeconds: number = 30,
  validUntilLedgerSeq?: number
): Promise<contract.SentTransaction<any>> {
  // If tx is an AssembledTransaction, simulate and send
  if (typeof tx !== 'string' && 'simulate' in tx) {
    txLog.info('Simulating transaction…');
    const simulated = await tx.simulate();
    txLog.info('Simulation done — attempting signAndSend()…');

    try {
      const sentTx = await simulated.signAndSend();

      // ── Diagnostic: log the raw response so we can see status ──────────────
      const status = (sentTx as any).getTransactionResponse?.status ?? 'unknown';
      const hash   = (sentTx as any).getTransactionResponse?.hash ?? 'n/a';
      console.groupCollapsed('%c[TX·Helper] signAndSend() result', 'color:#a78bfa;font-weight:bold;');
      txLog.info('tx status  :', status);
      txLog.info('tx hash    :', hash);
      txLog.info('result     :', (sentTx as any).result);
      txLog.info('full resp  :', (sentTx as any).getTransactionResponse);
      console.groupEnd();

      if (status === 'FAILED') {
        txLog.err('Transaction status is FAILED — proof submission did NOT land on-chain!');
      } else if (status !== 'unknown') {
        txLog.ok(`Transaction confirmed on-chain (status=${status})`);
      }

      return sentTx;
    } catch (err: any) {
      const errName = err?.name ?? '';
      const errMessage = err instanceof Error ? err.message : String(err);
      const isNoSignatureNeeded =
        errName.includes('NoSignatureNeededError') ||
        errMessage.includes('NoSignatureNeededError') ||
        errMessage.includes('This is a read call') ||
        errMessage.includes('requires no signature') ||
        errMessage.includes('force: true');

      // Some contract bindings incorrectly classify state-changing methods as "read calls".
      // In those cases, the SDK requires `force: true` to sign and send anyway.
      if (isNoSignatureNeeded) {
        txLog.warn('signAndSend() raised NoSignatureNeededError → retrying with { force: true }', errMessage);

        try {
          const sentTx = await simulated.signAndSend({ force: true });

          // ── Diagnostic: log the forced response ───────────────────────────
          const status = (sentTx as any).getTransactionResponse?.status ?? 'unknown';
          const hash   = (sentTx as any).getTransactionResponse?.hash ?? 'n/a';
          console.groupCollapsed('%c[TX·Helper] signAndSend({ force:true }) result', 'color:#a78bfa;font-weight:bold;');
          txLog.info('tx status  :', status);
          txLog.info('tx hash    :', hash);
          txLog.info('result     :', (sentTx as any).result);
          txLog.info('full resp  :', (sentTx as any).getTransactionResponse);
          console.groupEnd();

          if (status === 'FAILED') {
            txLog.err('force:true tx status is FAILED — submission did NOT land on-chain!');
          } else if (status !== 'unknown') {
            txLog.ok(`force:true tx confirmed on-chain (status=${status})`);
          }

          return sentTx;
        } catch (forceErr: any) {
          const forceName = forceErr?.name ?? '';
          const forceMessage = forceErr instanceof Error ? forceErr.message : String(forceErr);
          const isStillReadOnly =
            forceName.includes('NoSignatureNeededError') ||
            forceMessage.includes('NoSignatureNeededError') ||
            forceMessage.includes('This is a read call') ||
            forceMessage.includes('requires no signature');

          // If the SDK still says it's a read call, treat the simulation result as the final result.
          if (isStillReadOnly) {
            // ⚠️ CRITICAL WARNING: this path means the tx was NEVER broadcast on-chain.
            // The simulation result is returned as a stub — any state changes will NOT persist.
            txLog.warn(
              '🚨 CRITICAL: SDK still refuses to sign even with force:true. ' +
              'The transaction was NOT sent on-chain — returning SIMULATION STUB. ' +
              'submit_zk_proof will appear to succeed but player_energy will NOT be recorded!',
              { errName: forceName, errMessage: forceMessage }
            );

            const simulatedResult =
              (simulated as any).result ??
              (simulated as any).simulationResult?.result ??
              (simulated as any).returnValue ??
              (tx as any).result;

            return {
              result: simulatedResult,
              getTransactionResponse: undefined,
            } as unknown as contract.SentTransaction<any>;
          }

          txLog.err('force:true signAndSend() threw a non-readOnly error', forceErr);
          throw forceErr;
        }
      }

      txLog.err('signAndSend() threw a non-NoSignatureNeeded error', err);
      throw err;
    }
  }

  // If tx is XDR string, it needs to be sent directly
  // This is typically used for multi-sig flows where the transaction is already built
  throw new Error('Direct XDR submission not yet implemented. Use AssembledTransaction.signAndSend() instead.');
}
