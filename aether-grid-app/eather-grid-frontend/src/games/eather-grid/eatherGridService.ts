import { Client as EatherGridClient, type Game, type Outcome } from './bindings';
import { NETWORK_PASSPHRASE, RPC_URL, DEFAULT_METHOD_OPTIONS, DEFAULT_AUTH_TTL_MINUTES, MULTI_SIG_AUTH_TTL_MINUTES } from '@/utils/constants';
import { contract, TransactionBuilder, StrKey, xdr, Address, authorizeEntry } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import { signAndSendViaLaunchtube } from '@/utils/transactionHelper';
import { calculateValidUntilLedger } from '@/utils/ledgerUtils';
import { injectSignedAuthEntry } from '@/utils/authEntryUtils';

type ClientOptions = contract.ClientOptions;

/**
 * Service for interacting with the EatherGrid ZK-coordinate game contract.
 *
 * ## Contract changes (redesigned)
 * - `start_game` now requires a 6th argument: `treasure_hash: BytesN<32>`
 *   = Poseidon2(x, y, nullifier) committed by the player who knows the
 *   canonical treasure coordinates.
 * - `make_guess` / `reveal_winner` are REMOVED.
 * - `submit_zk_proof(session_id, player, proof, public_inputs, energy_used)` is NEW.
 * - `resolve_game(session_id)` is NEW.
 */
export class EatherGridService {
  private baseClient: EatherGridClient;
  private contractId: string;

  constructor(contractId: string) {
    this.contractId = contractId;
    this.baseClient = new EatherGridClient({
      contractId: this.contractId,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
      allowHttp: RPC_URL.startsWith('http://'),
    });
  }

  private createSigningClient(
    publicKey: string,
    signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>
  ): EatherGridClient {
    const options: ClientOptions = {
      contractId: this.contractId,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
      allowHttp: RPC_URL.startsWith('http://'),
      publicKey,
      ...signer,
    };
    return new EatherGridClient(options);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Queries
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Get game state. Returns null if the game doesn't exist.
   */
  async getGame(sessionId: number): Promise<Game | null> {
    try {
      const tx = await this.baseClient.get_game({ session_id: sessionId });
      const result = await tx.simulate();
      if (result.result.isOk()) {
        return result.result.unwrap();
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Return the 32-byte treasure hash committed at start_game.
   * Useful for displaying / passing into the ZK proof input.
   */
  async getTreasureHash(sessionId: number): Promise<Buffer | null> {
    try {
      const tx = await this.baseClient.get_treasure_hash({ session_id: sessionId });
      const result = await tx.simulate();
      if (result.result.isOk()) {
        return result.result.unwrap() as Buffer;
      }
      return null;
    } catch {
      return null;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Game Flow
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * STEP 1 (Player 1): Prepare a start_game transaction and export a signed
   * auth entry XDR for Player 2 to import.
   *
   * The `treasureHash` is the 32-byte Poseidon2(x, y, nullifier) value that
   * will be stored on-chain and used to validate ZK proofs later.
   * It must be derived from the canonical treasure coordinates before calling
   * this method.
   *
   * @param treasureHash 32-byte Buffer — Poseidon2(x,y,nullifier) for this session.
   */
  async prepareStartGame(
    sessionId: number,
    player1: string,
    player2: string,
    player1Points: bigint,
    player2Points: bigint,
    treasureHash: Buffer,
    player1Signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>,
    authTtlMinutes?: number
  ): Promise<string> {
    // Build the transaction with Player 2 as the source
    const buildClient = new EatherGridClient({
      contractId: this.contractId,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
      allowHttp: RPC_URL.startsWith('http://'),
      publicKey: player2,
    });

    // ⬇ The 6th parameter `treasure_hash` is the critical new addition.
    const tx = await buildClient.start_game({
      session_id: sessionId,
      player1,
      player2,
      player1_points: player1Points,
      player2_points: player2Points,
      treasure_hash: treasureHash,
    }, DEFAULT_METHOD_OPTIONS);

    console.log('[prepareStartGame] Transaction built and simulated');

    if (!tx.simulationData?.result?.auth) {
      throw new Error('No auth entries found in simulation');
    }

    const authEntries = tx.simulationData.result.auth;
    let player1AuthEntry = null;

    for (let i = 0; i < authEntries.length; i++) {
      const entry = authEntries[i];
      try {
        const entryAddress = entry.credentials().address().address();
        const entryAddressString = Address.fromScAddress(entryAddress).toString();
        if (entryAddressString === player1) {
          player1AuthEntry = entry;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!player1AuthEntry) {
      throw new Error(`No auth entry found for Player 1 (${player1}).`);
    }

    const validUntilLedgerSeq = authTtlMinutes
      ? await calculateValidUntilLedger(RPC_URL, authTtlMinutes)
      : await calculateValidUntilLedger(RPC_URL, MULTI_SIG_AUTH_TTL_MINUTES);

    if (!player1Signer.signAuthEntry) {
      throw new Error('signAuthEntry function not available');
    }

    const signedAuthEntry = await authorizeEntry(
      player1AuthEntry,
      async (preimage) => {
        if (!player1Signer.signAuthEntry) {
          throw new Error('Wallet does not support auth entry signing');
        }
        const signResult = await player1Signer.signAuthEntry(
          preimage.toXDR('base64'),
          { networkPassphrase: NETWORK_PASSPHRASE, address: player1 }
        );
        if (signResult.error) {
          throw new Error(`Failed to sign auth entry: ${signResult.error.message}`);
        }
        return Buffer.from(signResult.signedAuthEntry, 'base64');
      },
      validUntilLedgerSeq,
      NETWORK_PASSPHRASE
    );

    return signedAuthEntry.toXDR('base64');
  }

  /**
   * Parse a signed auth entry to extract game parameters.
   *
   * The auth entry from `require_auth_for_args` only contains:
   *   arg[0] = session_id (u32)
   *   arg[1] = player_points (i128)
   */
  parseAuthEntry(authEntryXdr: string): {
    sessionId: number;
    player1: string;
    player1Points: bigint;
    functionName: string;
  } {
    try {
      const authEntry = xdr.SorobanAuthorizationEntry.fromXDR(authEntryXdr, 'base64');
      const credentials = authEntry.credentials();
      const addressCreds = credentials.address();
      const player1Address = addressCreds.address();
      const player1 = Address.fromScAddress(player1Address).toString();

      const rootInvocation = authEntry.rootInvocation();
      const authorizedFunction = rootInvocation.function();
      const contractFn = authorizedFunction.contractFn();
      const functionName = contractFn.functionName().toString();

      if (functionName !== 'start_game') {
        throw new Error(`Unexpected function: ${functionName}. Expected start_game.`);
      }

      const args = contractFn.args();
      if (args.length !== 2) {
        throw new Error(`Expected 2 arguments for start_game auth entry, got ${args.length}`);
      }

      const sessionId = args[0].u32();
      const player1Points = args[1].i128().lo().toBigInt();

      return { sessionId, player1, player1Points, functionName };
    } catch (err: any) {
      throw new Error(`Failed to parse auth entry: ${err.message}`);
    }
  }

  /**
   * STEP 2 (Player 2): Import Player 1's signed auth entry and rebuild the
   * transaction with Player 2's own credentials and treasure_hash.
   *
   * @param treasureHash The same 32-byte Buffer used when Player 1 prepared.
   */
  async importAndSignAuthEntry(
    player1SignedAuthEntryXdr: string,
    player2Address: string,
    player2Points: bigint,
    treasureHash: Buffer,
    player2Signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>,
    authTtlMinutes?: number
  ): Promise<string> {
    const gameParams = this.parseAuthEntry(player1SignedAuthEntryXdr);

    if (player2Address === gameParams.player1) {
      throw new Error('Cannot play against yourself.');
    }

    const buildClient = new EatherGridClient({
      contractId: this.contractId,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
      allowHttp: RPC_URL.startsWith('http://'),
      publicKey: player2Address,
    });

    // ⬇ Must include treasure_hash here too — same value as Player 1 used.
    const tx = await buildClient.start_game({
      session_id: gameParams.sessionId,
      player1: gameParams.player1,
      player2: player2Address,
      player1_points: gameParams.player1Points,
      player2_points: player2Points,
      treasure_hash: treasureHash,
    }, DEFAULT_METHOD_OPTIONS);

    console.log('[importAndSignAuthEntry] Transaction rebuilt and simulated');

    const validUntilLedgerSeq = authTtlMinutes
      ? await calculateValidUntilLedger(RPC_URL, authTtlMinutes)
      : await calculateValidUntilLedger(RPC_URL, MULTI_SIG_AUTH_TTL_MINUTES);

    const txWithInjectedAuth = await injectSignedAuthEntry(
      tx,
      player1SignedAuthEntryXdr,
      player2Address,
      player2Signer,
      validUntilLedgerSeq
    );

    const player2Client = this.createSigningClient(player2Address, player2Signer);
    const player2Tx = player2Client.txFromXDR(txWithInjectedAuth.toXDR());

    const needsSigning = await player2Tx.needsNonInvokerSigningBy();
    if (needsSigning.includes(player2Address)) {
      await player2Tx.signAuthEntries({ expiration: validUntilLedgerSeq });
    }

    return player2Tx.toXDR();
  }

  /**
   * STEP 3: Finalize and broadcast the fully-signed start_game transaction.
   */
  async finalizeStartGame(
    xdr: string,
    signerAddress: string,
    signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>,
    authTtlMinutes?: number
  ) {
    const client = this.createSigningClient(signerAddress, signer);
    const tx = client.txFromXDR(xdr);
    await tx.simulate();

    const validUntilLedgerSeq = authTtlMinutes
      ? await calculateValidUntilLedger(RPC_URL, authTtlMinutes)
      : await calculateValidUntilLedger(RPC_URL, DEFAULT_AUTH_TTL_MINUTES);

    const sentTx = await signAndSendViaLaunchtube(
      tx,
      DEFAULT_METHOD_OPTIONS.timeoutInSeconds,
      validUntilLedgerSeq
    );
    return sentTx.result;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ZK Proof Submission
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Submit a ZK proof of treasure discovery to the contract.
   *
   * @param sessionId     Session ID.
   * @param playerAddress The submitting player's address.
   * @param proofBytes    Raw UltraHonk proof (Uint8Array / Buffer from Barretenberg).
   * @param publicInputsBuffer 32-byte buffer of the circuit's public output field.
   *                      Must equal game.treasure_hash on-chain.
   * @param energyUsed    Claimed path cost (lower is better for tiebreaking).
   * @param signer        Signing capabilities.
   */
  async submitZkProof(
    sessionId: number,
    playerAddress: string,
    proofBytes: Buffer,
    publicInputsBuffer: Buffer,
    energyUsed: number,
    signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>,
    authTtlMinutes?: number
  ) {
    const client = this.createSigningClient(playerAddress, signer);

    const tx = await client.submit_zk_proof({
      session_id: sessionId,
      player: playerAddress,
      proof: proofBytes,
      public_inputs: publicInputsBuffer,
      energy_used: energyUsed,
    }, DEFAULT_METHOD_OPTIONS);

    const validUntilLedgerSeq = authTtlMinutes
      ? await calculateValidUntilLedger(RPC_URL, authTtlMinutes)
      : await calculateValidUntilLedger(RPC_URL, DEFAULT_AUTH_TTL_MINUTES);

    try {
      const sentTx = await signAndSendViaLaunchtube(
        tx,
        DEFAULT_METHOD_OPTIONS.timeoutInSeconds,
        validUntilLedgerSeq
      );
      if (sentTx.getTransactionResponse?.status === 'FAILED') {
        const errorMessage = this.extractErrorFromDiagnostics(sentTx.getTransactionResponse);
        throw new Error(`Transaction failed: ${errorMessage}`);
      }
      return sentTx.result;
    } catch (err) {
      if (err instanceof Error && err.message.includes('Transaction failed!')) {
        throw new Error('ZK proof submission failed — check that the proof is valid and matches the session treasury hash.');
      }
      throw err;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Game Resolution
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Resolve the game and report the outcome to Game Hub.
   * Permissionless — can be called by either player or any third party.
   * Requires at least one proof to have been submitted.
   */
  async resolveGame(
    sessionId: number,
    callerAddress: string,
    signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>,
    authTtlMinutes?: number
  ): Promise<Outcome> {
    const client = this.createSigningClient(callerAddress, signer);
    const tx = await client.resolve_game({ session_id: sessionId }, DEFAULT_METHOD_OPTIONS);

    const validUntilLedgerSeq = authTtlMinutes
      ? await calculateValidUntilLedger(RPC_URL, authTtlMinutes)
      : await calculateValidUntilLedger(RPC_URL, DEFAULT_AUTH_TTL_MINUTES);

    try {
      const sentTx = await signAndSendViaLaunchtube(
        tx,
        DEFAULT_METHOD_OPTIONS.timeoutInSeconds,
        validUntilLedgerSeq
      );
      if (sentTx.getTransactionResponse?.status === 'FAILED') {
        const errorMessage = this.extractErrorFromDiagnostics(sentTx.getTransactionResponse);
        throw new Error(`Transaction failed: ${errorMessage}`);
      }
      return sentTx.result as Outcome;
    } catch (err) {
      if (err instanceof Error && err.message.includes('Transaction failed!')) {
        throw new Error('Failed to resolve game — ensure at least one player has submitted a valid proof.');
      }
      throw err;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Transaction Parse Helpers
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Parse a start_game transaction XDR to extract game parameters.
   *
   * Updated to expect 6 arguments (session_id, player1, player2, p1_points,
   * p2_points, treasure_hash) in the new contract.
   */
  parseTransactionXDR(xdr: string): {
    sessionId: number;
    player1: string;
    player2: string;
    player1Points: bigint;
    player2Points: bigint;
    treasureHash: Buffer;
    transactionSource: string;
    functionName: string;
  } {
    const transaction = TransactionBuilder.fromXDR(xdr, NETWORK_PASSPHRASE);
    const transactionSource = 'source' in transaction ? transaction.source : '';

    const operation = transaction.operations[0];
    if (!operation || operation.type !== 'invokeHostFunction') {
      throw new Error('Transaction does not contain a contract invocation');
    }

    const func = operation.func;
    const invokeContractArgs = func.invokeContract();
    const functionName = invokeContractArgs.functionName().toString();
    const args = invokeContractArgs.args();

    if (functionName !== 'start_game') {
      throw new Error(`Unexpected function: ${functionName}. Expected start_game.`);
    }

    // New contract: 6 args (was 5)
    if (args.length !== 6) {
      throw new Error(`Expected 6 arguments for start_game, got ${args.length}`);
    }

    const sessionId = args[0].u32();

    const player1ScVal = args[1];
    const player1Address = player1ScVal.address().accountId().ed25519();
    const player1 = StrKey.encodeEd25519PublicKey(player1Address);

    const player2ScVal = args[2];
    const player2Address = player2ScVal.address().accountId().ed25519();
    const player2 = StrKey.encodeEd25519PublicKey(player2Address);

    const player1Points = args[3].i128().lo().toBigInt();
    const player2Points = args[4].i128().lo().toBigInt();

    // arg[5] is BytesN<32> — convert ScVal bytes to a Buffer
    const treasureHashBytes = args[5].bytes();
    const treasureHash = Buffer.from(treasureHashBytes);

    return {
      sessionId,
      player1,
      player2,
      player1Points,
      player2Points,
      treasureHash,
      transactionSource,
      functionName,
    };
  }

  async checkRequiredSignatures(xdrString: string, publicKey: string): Promise<string[]> {
    const client = this.createSigningClient(publicKey, {
      signTransaction: async (x: string) => ({ signedTxXdr: x }),
      signAuthEntry: async (x: string) => ({ signedAuthEntry: x }),
    });
    const tx = client.txFromXDR(xdrString);
    return tx.needsNonInvokerSigningBy();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private Helpers
  // ──────────────────────────────────────────────────────────────────────────

  private extractErrorFromDiagnostics(transactionResponse: any): string {
    try {
      console.error('Transaction response:', JSON.stringify(transactionResponse, null, 2));
      const diagnosticEvents =
        transactionResponse?.diagnosticEventsXdr ||
        transactionResponse?.diagnostic_events || [];

      for (const event of diagnosticEvents) {
        if (event?.topics) {
          const topics = Array.isArray(event.topics) ? event.topics : [];
          const hasErrorTopic = topics.some(
            (topic: any) => topic?.symbol === 'error' || topic?.error
          );
          if (hasErrorTopic && event.data) {
            if (typeof event.data === 'string') return event.data;
            if (event.data.vec && Array.isArray(event.data.vec)) {
              const messages = event.data.vec
                .filter((item: any) => item?.string)
                .map((item: any) => item.string);
              if (messages.length > 0) return messages.join(': ');
            }
          }
        }
      }

      const status = transactionResponse?.status || 'Unknown';
      return `Transaction ${status}. Check console for details.`;
    } catch {
      return 'Transaction failed with unknown error';
    }
  }
}
