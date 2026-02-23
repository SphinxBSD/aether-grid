import { useState, useEffect, useRef } from 'react';
import { Buffer } from 'buffer';
import { EatherGridService } from './eatherGridService';
import { requestCache, createCacheKey } from '@/utils/requestCache';
import { useWallet } from '@/hooks/useWallet';
import { EATHER_GRID_CONTRACT } from '@/utils/constants';
import { getFundedSimulationSourceAddress } from '@/utils/simulationUtils';
import { devWalletService, DevWalletService } from '@/services/devWalletService';
import { ZkProofSection, readEnergyUsed } from './ZkProofSection';
import type { ZkProofResult } from './ZkProofSection';
import type { Game, Outcome } from './bindings';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const createRandomSessionId = (): number => {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    let value = 0;
    const buffer = new Uint32Array(1);
    while (value === 0) {
      crypto.getRandomValues(buffer);
      value = buffer[0];
    }
    return value;
  }
  return (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
};

/**
 * Derive the session-bound nullifier as:
 *   keccak256(session_id_be ‖ player1_bytes ‖ player2_bytes)
 *
 * This is intentionally NOT done client-side for the game itself — the player
 * who knows the coordinates provides the nullifier. This helper is for the
 * quickstart dev path where we generate a deterministic placeholder.
 */
function derivePlaceholderNullifier(sessionId: number): string {
  // For dev/demo purposes: just return sessionId as a decimal field string.
  // In production the player derives keccak256(...) off-chain.
  return sessionId.toString();
}

/**
 * Convert a Buffer (32 bytes) to a hex string without 0x prefix.
 */
function bufferToHex(buf: Buffer): string {
  return buf.toString('hex');
}

// ─── Component ────────────────────────────────────────────────────────────────

const eatherGridService = new EatherGridService(EATHER_GRID_CONTRACT);

interface EatherGridGameProps {
  userAddress: string;
  currentEpoch: number;
  availablePoints: bigint;
  initialXDR?: string | null;
  initialSessionId?: number | null;
  onStandingsRefresh: () => void;
  onGameComplete: () => void;
}

/**
 * EatherGrid Game UI — ZK coordinates edition.
 *
 * Flow:
 *   1. CREATE phase  — Player 1 prepares + exports a signed auth entry XDR.
 *   2. Player 2 imports the XDR, signs, and finalises → game is on-chain.
 *   3. PROVE phase   — Each player generates a ZK proof in-browser and submits.
 *   4. RESOLVE phase — Anyone resolves the game; winner determined by energy.
 *   5. COMPLETE      — Outcome displayed.
 */
export function EatherGridGame({
  userAddress,
  availablePoints,
  initialXDR,
  initialSessionId,
  onStandingsRefresh,
  onGameComplete,
}: EatherGridGameProps) {
  const DEFAULT_POINTS = '0.1';
  const { getContractSigner, walletType } = useWallet();

  // ── Game state ────────────────────────────────────────────────────────────
  const [sessionId, setSessionId] = useState<number>(() => createRandomSessionId());
  const [player1Address, setPlayer1Address] = useState(userAddress);
  const [player1Points, setPlayer1Points] = useState(DEFAULT_POINTS);
  const [gameState, setGameState] = useState<Game | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [loading, setLoading] = useState(false);
  const [quickstartLoading, setQuickstartLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  /**
   * Game phases:
   *   create  → both players sign start_game
   *   prove   → each player generates + submits their ZK proof
   *   resolve → proof(s) submitted; awaiting resolve_game call
   *   complete → game resolved
   */
  const [gamePhase, setGamePhase] = useState<'create' | 'prove' | 'resolve' | 'complete'>('create');
  const [createMode, setCreateMode] = useState<'create' | 'import' | 'load'>('create');

  // ── Create / import state ─────────────────────────────────────────────────
  const [exportedAuthEntryXDR, setExportedAuthEntryXDR] = useState<string | null>(null);
  const [importAuthEntryXDR, setImportAuthEntryXDR] = useState('');
  const [importSessionId, setImportSessionId] = useState('');
  const [importPlayer1, setImportPlayer1] = useState('');
  const [importPlayer1Points, setImportPlayer1Points] = useState('');
  const [importPlayer2Points, setImportPlayer2Points] = useState(DEFAULT_POINTS);
  const [loadSessionId, setLoadSessionId] = useState('');

  /**
   * The treasure hash committed at start_game (Poseidon2(x,y,nullifier)).
   * Stored as a hex string (no 0x prefix) for display; converted to Buffer when needed.
   *
   * In this mock UI the player must enter their coordinates in the ZK section.
   * The ZkProofSection will use `treasureHashHex` as the `xy_nullifier_hashed` input.
   *
   * For the quickstart path, we generate a placeholder hash of zeros.
   */
  const [treasureHashHex, setTreasureHashHex] = useState('');
  const [treasureHashInput, setTreasureHashInput] = useState('');

  // ── Proof submission state ────────────────────────────────────────────────
  const [proofReady, setProofReady] = useState(false);
  const [pendingProof, setPendingProof] = useState<ZkProofResult | null>(null);
  const [proofSubmitted, setProofSubmitted] = useState(false);

  // ── Copy state ────────────────────────────────────────────────────────────
  const [authEntryCopied, setAuthEntryCopied] = useState(false);
  const [shareUrlCopied, setShareUrlCopied] = useState(false);
  const [xdrParsing, setXdrParsing] = useState(false);
  const [xdrParseError, setXdrParseError] = useState<string | null>(null);
  const [xdrParseSuccess, setXdrParseSuccess] = useState(false);

  const POINTS_DECIMALS = 7;
  const isBusy = loading || quickstartLoading;
  const actionLock = useRef(false);

  const quickstartAvailable = walletType === 'dev'
    && DevWalletService.isDevModeAvailable()
    && DevWalletService.isPlayerAvailable(1)
    && DevWalletService.isPlayerAvailable(2);

  // ── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => {
    setPlayer1Address(userAddress);
  }, [userAddress]);

  useEffect(() => {
    if (createMode === 'import' && !importPlayer2Points.trim()) {
      setImportPlayer2Points(DEFAULT_POINTS);
    }
  }, [createMode, importPlayer2Points]);

  const loadGameState = async () => {
    try {
      const game = await eatherGridService.getGame(sessionId);
      setGameState(game);

      if (!game) return;

      // Progress game phase based on proof submission state
      if (game.resolved) {
        setGamePhase('complete');
      } else if (game.player1_energy !== null || game.player2_energy !== null) {
        setGamePhase('resolve');
      } else {
        setGamePhase('prove');
      }

      // Refresh treasure hash if we don't have it yet
      if (!treasureHashHex) {
        const hash = await eatherGridService.getTreasureHash(sessionId);
        if (hash) setTreasureHashHex(bufferToHex(hash));
      }
    } catch {
      setGameState(null);
    }
  };

  useEffect(() => {
    if (gamePhase !== 'create') {
      loadGameState();
      const interval = setInterval(loadGameState, 5000);
      return () => clearInterval(interval);
    }
  }, [sessionId, gamePhase]);

  useEffect(() => {
    if ((gamePhase === 'complete' || gamePhase === 'resolve') && gameState?.resolved) {
      onStandingsRefresh();
    }
  }, [gamePhase, gameState?.resolved]);

  // Deep-link auto-populate
  useEffect(() => {
    if (initialXDR) {
      try {
        const parsed = eatherGridService.parseAuthEntry(initialXDR);
        eatherGridService.getGame(parsed.sessionId).then((game) => {
          if (game) {
            setGameState(game);
            setGamePhase('prove');
            setSessionId(parsed.sessionId);
          } else {
            setCreateMode('import');
            setImportAuthEntryXDR(initialXDR);
            setImportSessionId(parsed.sessionId.toString());
            setImportPlayer1(parsed.player1);
            setImportPlayer1Points((Number(parsed.player1Points) / 10_000_000).toString());
            setImportPlayer2Points('0.1');
          }
        }).catch(() => {
          setCreateMode('import');
          setImportAuthEntryXDR(initialXDR);
        });
      } catch {
        setCreateMode('import');
        setImportAuthEntryXDR(initialXDR);
      }
      return;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const authEntry = urlParams.get('auth');
    const urlSessionId = urlParams.get('session-id');

    if (authEntry) {
      try {
        const parsed = eatherGridService.parseAuthEntry(authEntry);
        eatherGridService.getGame(parsed.sessionId).then((game) => {
          if (game) {
            setGameState(game);
            setGamePhase('prove');
            setSessionId(parsed.sessionId);
          } else {
            setCreateMode('import');
            setImportAuthEntryXDR(authEntry);
            setImportSessionId(parsed.sessionId.toString());
            setImportPlayer1(parsed.player1);
            setImportPlayer1Points((Number(parsed.player1Points) / 10_000_000).toString());
            setImportPlayer2Points('0.1');
          }
        }).catch(() => {
          setCreateMode('import');
          setImportAuthEntryXDR(authEntry);
        });
      } catch {
        setCreateMode('import');
        setImportAuthEntryXDR(authEntry);
      }
    } else if (urlSessionId) {
      setCreateMode('load');
      setLoadSessionId(urlSessionId);
    } else if (initialSessionId !== null && initialSessionId !== undefined) {
      setCreateMode('load');
      setLoadSessionId(initialSessionId.toString());
    }
  }, [initialXDR, initialSessionId]);

  // Auto-parse auth entry XDR
  useEffect(() => {
    if (createMode !== 'import' || !importAuthEntryXDR.trim()) {
      if (!importAuthEntryXDR.trim()) {
        setXdrParsing(false);
        setXdrParseError(null);
        setXdrParseSuccess(false);
        setImportSessionId('');
        setImportPlayer1('');
        setImportPlayer1Points('');
      }
      return;
    }

    const parseXDR = async () => {
      setXdrParsing(true);
      setXdrParseError(null);
      setXdrParseSuccess(false);
      try {
        const gameParams = eatherGridService.parseAuthEntry(importAuthEntryXDR.trim());
        if (gameParams.player1 === userAddress) {
          throw new Error('You cannot play against yourself.');
        }
        setImportSessionId(gameParams.sessionId.toString());
        setImportPlayer1(gameParams.player1);
        setImportPlayer1Points((Number(gameParams.player1Points) / 10_000_000).toString());
        setXdrParseSuccess(true);
      } catch (err) {
        setXdrParseError(err instanceof Error ? err.message : 'Invalid auth entry XDR');
        setImportSessionId('');
        setImportPlayer1('');
        setImportPlayer1Points('');
      } finally {
        setXdrParsing(false);
      }
    };

    const timeoutId = setTimeout(parseXDR, 500);
    return () => clearTimeout(timeoutId);
  }, [importAuthEntryXDR, createMode, userAddress]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const runAction = async (action: () => Promise<void>) => {
    if (actionLock.current || isBusy) return;
    actionLock.current = true;
    try {
      await action();
    } finally {
      actionLock.current = false;
    }
  };

  const parsePoints = (value: string): bigint | null => {
    try {
      const cleaned = value.replace(/[^\d.]/g, '');
      if (!cleaned || cleaned === '.') return null;
      const [whole = '0', fraction = ''] = cleaned.split('.');
      const paddedFraction = fraction.padEnd(POINTS_DECIMALS, '0').slice(0, POINTS_DECIMALS);
      return BigInt(whole + paddedFraction);
    } catch {
      return null;
    }
  };

  /**
   * Build a 32-byte treasure hash buffer from the hex input field.
   * Returns null if the input is invalid.
   */
  const parseTreasureHash = (hexInput: string): Buffer | null => {
    try {
      const clean = hexInput.trim().replace(/^0x/, '');
      if (clean.length === 0) return null;
      // Pad to 64 chars (32 bytes)
      const padded = clean.padStart(64, '0').slice(-64);
      return Buffer.from(padded, 'hex');
    } catch {
      return null;
    }
  };

  const handleStartNewGame = () => {
    if (gameState?.resolved) onGameComplete();
    actionLock.current = false;
    setGamePhase('create');
    setSessionId(createRandomSessionId());
    setGameState(null);
    setOutcome(null);
    setLoading(false);
    setQuickstartLoading(false);
    setError(null);
    setSuccess(null);
    setCreateMode('create');
    setExportedAuthEntryXDR(null);
    setImportAuthEntryXDR('');
    setImportSessionId('');
    setImportPlayer1('');
    setImportPlayer1Points('');
    setImportPlayer2Points(DEFAULT_POINTS);
    setLoadSessionId('');
    setAuthEntryCopied(false);
    setShareUrlCopied(false);
    setXdrParsing(false);
    setXdrParseError(null);
    setXdrParseSuccess(false);
    setPlayer1Address(userAddress);
    setPlayer1Points(DEFAULT_POINTS);
    setTreasureHashHex('');
    setTreasureHashInput('');
    setProofReady(false);
    setPendingProof(null);
    setProofSubmitted(false);
  };

  // ── Create: step 1 ────────────────────────────────────────────────────────

  const handlePrepareTransaction = async () => {
    await runAction(async () => {
      try {
        setLoading(true);
        setError(null);
        setSuccess(null);

        const p1Points = parsePoints(player1Points);
        if (!p1Points || p1Points <= 0n) throw new Error('Enter a valid points amount');

        const treasureHash = parseTreasureHash(treasureHashInput);
        if (!treasureHash) {
          throw new Error('Enter a valid 32-byte treasure hash (hex). Compute Poseidon2(x, y, nullifier) off-chain first.');
        }

        const signer = getContractSigner();
        const placeholderPlayer2Address = await getFundedSimulationSourceAddress([player1Address, userAddress]);

        const authEntryXDR = await eatherGridService.prepareStartGame(
          sessionId,
          player1Address,
          placeholderPlayer2Address,
          p1Points,
          p1Points,
          treasureHash,
          signer
        );

        setExportedAuthEntryXDR(authEntryXDR);
        setTreasureHashHex(bufferToHex(treasureHash));
        setSuccess('Auth entry signed! Share with Player 2.');

        // Poll until game is created by Player 2
        const pollInterval = setInterval(async () => {
          const game = await eatherGridService.getGame(sessionId);
          if (game) {
            clearInterval(pollInterval);
            setGameState(game);
            setExportedAuthEntryXDR(null);
            setSuccess('Game started! Generate your ZK proof to submit your coordinates.');
            setGamePhase('prove');
            onStandingsRefresh();
            setTimeout(() => setSuccess(null), 3000);
          }
        }, 3000);

        setTimeout(() => clearInterval(pollInterval), 300_000);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to prepare transaction');
      } finally {
        setLoading(false);
      }
    });
  };

  // ── Create: quickstart ────────────────────────────────────────────────────

  const handleQuickStart = async () => {
    await runAction(async () => {
      try {
        setQuickstartLoading(true);
        setError(null);
        setSuccess(null);

        if (walletType !== 'dev') throw new Error('Quickstart only works with dev wallets.');
        if (!DevWalletService.isDevModeAvailable() || !DevWalletService.isPlayerAvailable(1) || !DevWalletService.isPlayerAvailable(2)) {
          throw new Error('Quickstart requires both dev wallets.');
        }

        const p1Points = parsePoints(player1Points);
        if (!p1Points || p1Points <= 0n) throw new Error('Enter a valid points amount');

        const originalPlayer = devWalletService.getCurrentPlayer();
        let player1AddressQS = '';
        let player2AddressQS = '';
        let player1Signer: ReturnType<typeof devWalletService.getSigner> | null = null;
        let player2Signer: ReturnType<typeof devWalletService.getSigner> | null = null;

        try {
          await devWalletService.initPlayer(1);
          player1AddressQS = devWalletService.getPublicKey();
          player1Signer = devWalletService.getSigner();
          await devWalletService.initPlayer(2);
          player2AddressQS = devWalletService.getPublicKey();
          player2Signer = devWalletService.getSigner();
        } finally {
          if (originalPlayer) await devWalletService.initPlayer(originalPlayer);
        }

        if (!player1Signer || !player2Signer) throw new Error('Failed to init dev wallet signers.');
        if (player1AddressQS === player2AddressQS) throw new Error('Players must be different.');

        const qsSessionId = createRandomSessionId();
        setSessionId(qsSessionId);
        setPlayer1Address(player1AddressQS);

        // Placeholder treasure hash (all-zeros) for the quickstart demo.
        // In a real game the player provides the actual Poseidon2 hash.
        const placeholderHash = Buffer.alloc(32, 0);
        const hashHex = bufferToHex(placeholderHash);
        setTreasureHashHex(hashHex);

        const placeholderP2 = await getFundedSimulationSourceAddress([player1AddressQS, player2AddressQS]);

        const authEntryXDR = await eatherGridService.prepareStartGame(
          qsSessionId,
          player1AddressQS,
          placeholderP2,
          p1Points,
          p1Points,
          placeholderHash,
          player1Signer
        );

        const fullySignedTxXDR = await eatherGridService.importAndSignAuthEntry(
          authEntryXDR,
          player2AddressQS,
          p1Points,
          placeholderHash,
          player2Signer
        );

        await eatherGridService.finalizeStartGame(fullySignedTxXDR, player2AddressQS, player2Signer);

        const game = await eatherGridService.getGame(qsSessionId);
        setGameState(game);
        setGamePhase('prove');
        onStandingsRefresh();
        setSuccess('Quickstart complete! Now generate your ZK proof.\n(Quickstart used a zeroed treasure hash — swap in your real coordinates for actual gameplay.)');
        setTimeout(() => setSuccess(null), 5000);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Quickstart failed');
      } finally {
        setQuickstartLoading(false);
      }
    });
  };

  // ── Create: import ────────────────────────────────────────────────────────

  const handleImportTransaction = async () => {
    await runAction(async () => {
      try {
        setLoading(true);
        setError(null);
        setSuccess(null);

        if (!importAuthEntryXDR.trim()) throw new Error('Paste Player 1\'s auth entry XDR');
        if (!importPlayer2Points.trim()) throw new Error('Enter your points amount');

        const treasureHash = parseTreasureHash(treasureHashInput);
        if (!treasureHash) {
          throw new Error('Enter the 32-byte treasure hash (hex) that Player 1 committed at game creation.');
        }

        const p2Points = parsePoints(importPlayer2Points);
        if (!p2Points || p2Points <= 0n) throw new Error('Invalid points');

        const gameParams = eatherGridService.parseAuthEntry(importAuthEntryXDR.trim());
        if (gameParams.player1 === userAddress) {
          throw new Error('You cannot play against yourself.');
        }

        setImportSessionId(gameParams.sessionId.toString());
        setImportPlayer1(gameParams.player1);
        setImportPlayer1Points((Number(gameParams.player1Points) / 10_000_000).toString());

        const signer = getContractSigner();

        const fullySignedTxXDR = await eatherGridService.importAndSignAuthEntry(
          importAuthEntryXDR.trim(),
          userAddress,
          p2Points,
          treasureHash,
          signer
        );

        await eatherGridService.finalizeStartGame(fullySignedTxXDR, userAddress, signer);

        setSessionId(gameParams.sessionId);
        setTreasureHashHex(bufferToHex(treasureHash));
        setSuccess('Game created! Generate your ZK proof.');
        setGamePhase('prove');

        setImportAuthEntryXDR('');
        setImportSessionId('');
        setImportPlayer1('');
        setImportPlayer1Points('');
        setImportPlayer2Points(DEFAULT_POINTS);

        await loadGameState();
        onStandingsRefresh();
        setTimeout(() => setSuccess(null), 3000);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to import auth entry');
      } finally {
        setLoading(false);
      }
    });
  };

  // ── Create: load ──────────────────────────────────────────────────────────

  const handleLoadExistingGame = async () => {
    await runAction(async () => {
      try {
        setLoading(true);
        setError(null);
        setSuccess(null);
        const parsedSessionId = parseInt(loadSessionId.trim());
        if (isNaN(parsedSessionId) || parsedSessionId <= 0) throw new Error('Enter a valid session ID');

        const game = await requestCache.dedupe(
          createCacheKey('game-state', parsedSessionId),
          () => eatherGridService.getGame(parsedSessionId),
          5000
        );

        if (!game) throw new Error('Game not found');
        if (game.player1 !== userAddress && game.player2 !== userAddress) {
          throw new Error('You are not a player in this game');
        }

        setSessionId(parsedSessionId);
        setGameState(game);
        setLoadSessionId('');

        // Load treasure hash from chain
        const hash = await eatherGridService.getTreasureHash(parsedSessionId);
        if (hash) setTreasureHashHex(bufferToHex(hash));

        if (game.resolved) {
          setGamePhase('complete');
        } else if (game.player1_energy !== null || game.player2_energy !== null) {
          setGamePhase('resolve');
          setSuccess('Game loaded! Waiting for resolve or submit your own proof.');
        } else {
          setGamePhase('prove');
          setSuccess('Game loaded! Generate your ZK proof.');
        }

        setTimeout(() => setSuccess(null), 3000);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load game');
      } finally {
        setLoading(false);
      }
    });
  };

  // ── Prove phase ───────────────────────────────────────────────────────────

  const handleProofReady = (result: ZkProofResult) => {
    setPendingProof(result);
    setProofReady(true);
  };

  const handleSubmitProof = async () => {
    if (!pendingProof) return;

    await runAction(async () => {
      try {
        setLoading(true);
        setError(null);
        setSuccess(null);

        const energyUsed = readEnergyUsed();
        const signer = getContractSigner();

        await eatherGridService.submitZkProof(
          sessionId,
          userAddress,
          pendingProof.proofBytes,
          pendingProof.publicInputsBuffer,
          energyUsed,
          signer
        );

        setProofSubmitted(true);
        setSuccess('ZK proof submitted! Waiting for the other player, then resolve the game.');
        setGamePhase('resolve');
        await loadGameState();
        onStandingsRefresh();
        setTimeout(() => setSuccess(null), 4000);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to submit ZK proof');
      } finally {
        setLoading(false);
      }
    });
  };

  // ── Resolve phase ─────────────────────────────────────────────────────────

  const handleResolveGame = async () => {
    await runAction(async () => {
      try {
        setLoading(true);
        setError(null);
        setSuccess(null);

        const signer = getContractSigner();
        const result = await eatherGridService.resolveGame(sessionId, userAddress, signer);
        setOutcome(result);
        setGamePhase('complete');
        onStandingsRefresh();
        setSuccess('Game resolved!');
        setTimeout(() => setSuccess(null), 3000);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to resolve game');
      } finally {
        setLoading(false);
      }
    });
  };

  // ── Copy helpers ──────────────────────────────────────────────────────────

  const copyAuthEntryToClipboard = async () => {
    if (exportedAuthEntryXDR) {
      await navigator.clipboard.writeText(exportedAuthEntryXDR);
      setAuthEntryCopied(true);
      setTimeout(() => setAuthEntryCopied(false), 2000);
    }
  };

  const copyShareGameUrlWithAuthEntry = async () => {
    if (exportedAuthEntryXDR) {
      const params = new URLSearchParams({ game: 'eather-grid', auth: exportedAuthEntryXDR });
      await navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?${params}`);
      setShareUrlCopied(true);
      setTimeout(() => setShareUrlCopied(false), 2000);
    }
  };

  const copyShareGameUrlWithSessionId = async () => {
    if (loadSessionId) {
      await navigator.clipboard.writeText(
        `${window.location.origin}${window.location.pathname}?game=eather-grid&session-id=${loadSessionId}`
      );
      setShareUrlCopied(true);
      setTimeout(() => setShareUrlCopied(false), 2000);
    }
  };

  // ── Derived helpers ───────────────────────────────────────────────────────

  const isPlayer1 = gameState && gameState.player1 === userAddress;
  const isPlayer2 = gameState && gameState.player2 === userAddress;

  const p1SubmittedProof = gameState && gameState.player1_energy !== null && gameState.player1_energy !== undefined;
  const p2SubmittedProof = gameState && gameState.player2_energy !== null && gameState.player2_energy !== undefined;

  const myProofSubmitted = (isPlayer1 && p1SubmittedProof) || (isPlayer2 && p2SubmittedProof);

  const outcomeLabel: Record<string, string> = {
    Player1Won: 'Player 1 Won!',
    Player2Won: 'Player 2 Won!',
    BothFoundTreasure: 'Both found the treasure — Player 1 wins the tiebreaker!',
    NeitherFound: 'Neither player found the treasure.',
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="bg-white/70 backdrop-blur-xl rounded-2xl p-8 shadow-xl border-2 border-purple-200">
      {/* Header */}
      <div className="flex items-center mb-6">
        <div>
          <h2 className="text-3xl font-black bg-gradient-to-r from-purple-600 via-pink-600 to-red-600 bg-clip-text text-transparent">
            Eather Grid 🗺️🔐
          </h2>
          <p className="text-sm text-gray-700 font-semibold mt-1">
            Prove your treasure coordinates with Zero-Knowledge proofs
          </p>
          <p className="text-xs text-gray-500 font-mono mt-1">Session ID: {sessionId}</p>
        </div>
      </div>

      {/* Error / Success banners */}
      {error && (
        <div className="mb-6 p-4 bg-gradient-to-r from-red-50 to-pink-50 border-2 border-red-200 rounded-xl">
          <p className="text-sm font-semibold text-red-700">{error}</p>
        </div>
      )}
      {success && (
        <div className="mb-6 p-4 bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-200 rounded-xl">
          <p className="text-sm font-semibold text-green-700">{success}</p>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          CREATE PHASE
          ══════════════════════════════════════════════════════════════════════ */}
      {gamePhase === 'create' && (
        <div className="space-y-6">
          {/* Mode toggle */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 p-2 bg-gray-100 rounded-xl">
            {(['create', 'import', 'load'] as const).map((mode) => {
              const labels = { create: 'Create & Export', import: 'Import Auth Entry', load: 'Load Existing' };
              const colours = {
                create: 'from-purple-500 to-pink-500',
                import: 'from-blue-500 to-cyan-500',
                load: 'from-green-500 to-emerald-500',
              };
              return (
                <button
                  key={mode}
                  onClick={() => {
                    setCreateMode(mode);
                    setExportedAuthEntryXDR(null);
                    if (mode !== 'import') { setImportAuthEntryXDR(''); setImportSessionId(''); setImportPlayer1(''); setImportPlayer1Points(''); }
                    if (mode !== 'load') setLoadSessionId('');
                  }}
                  className={`flex-1 py-3 px-4 rounded-lg font-bold text-sm transition-all ${
                    createMode === mode
                      ? `bg-gradient-to-r ${colours[mode]} text-white shadow-lg`
                      : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {labels[mode]}
                </button>
              );
            })}
          </div>

          {/* Quickstart */}
          <div className="p-4 bg-gradient-to-r from-yellow-50 to-orange-50 border-2 border-yellow-200 rounded-xl">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-yellow-900">⚡ Quickstart (Dev)</p>
                <p className="text-xs font-semibold text-yellow-800">Both dev wallets sign in one click. Uses a zeroed treasure hash — swap coordinates to test ZK proofs.</p>
              </div>
              <button
                onClick={handleQuickStart}
                disabled={isBusy || !quickstartAvailable}
                className="px-4 py-3 rounded-xl font-bold text-sm text-white bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500 transition-all shadow-md"
              >
                {quickstartLoading ? 'Quickstarting…' : '⚡ Quickstart Game'}
              </button>
            </div>
          </div>

          {/* ── Create mode ── */}
          {createMode === 'create' && (
            <div className="space-y-6">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Your Address (Player 1)</label>
                  <input
                    type="text"
                    value={player1Address}
                    onChange={(e) => setPlayer1Address(e.target.value.trim())}
                    placeholder="G..."
                    className="w-full px-4 py-3 rounded-xl bg-white border-2 border-gray-200 focus:outline-none focus:border-purple-400 focus:ring-4 focus:ring-purple-100 text-sm font-medium"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Your Points</label>
                  <input
                    type="text"
                    value={player1Points}
                    onChange={(e) => setPlayer1Points(e.target.value)}
                    placeholder="0.1"
                    className="w-full px-4 py-3 rounded-xl bg-white border-2 border-gray-200 focus:outline-none focus:border-purple-400 focus:ring-4 focus:ring-purple-100 text-sm"
                  />
                  <p className="text-xs text-gray-500 mt-1">Available: {(Number(availablePoints) / 10_000_000).toFixed(2)} Points</p>
                </div>
                {/* Treasure hash input */}
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">
                    Treasure Hash <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="treasure-hash-input"
                    type="text"
                    value={treasureHashInput}
                    onChange={(e) => setTreasureHashInput(e.target.value)}
                    placeholder="Poseidon2(x, y, nullifier) — 64-char hex"
                    className="w-full px-4 py-3 rounded-xl bg-white border-2 border-gray-200 focus:outline-none focus:border-purple-400 focus:ring-4 focus:ring-purple-100 text-sm font-mono"
                  />
                  <p className="text-xs text-gray-500 mt-1 font-semibold">
                    Compute <code>Poseidon2(x, y, nullifier)</code> for your treasure coordinates before starting the game.
                    This commits your coordinates without revealing them.
                  </p>
                </div>
                <div className="p-3 bg-blue-50 border-2 border-blue-200 rounded-xl">
                  <p className="text-xs font-semibold text-blue-800">
                    ℹ️ Player 2 will specify their own points and the same treasure hash when they import your auth entry.
                  </p>
                </div>
              </div>

              <div className="pt-4 border-t-2 border-gray-100 space-y-4">
                <p className="text-xs font-semibold text-gray-600">Session ID: {sessionId}</p>
                {!exportedAuthEntryXDR ? (
                  <button
                    id="prepare-auth-entry-btn"
                    onClick={handlePrepareTransaction}
                    disabled={isBusy}
                    className="w-full py-4 rounded-xl font-bold text-white text-sm bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500 transition-all shadow-lg hover:shadow-xl transform hover:scale-105 disabled:transform-none"
                  >
                    {loading ? 'Preparing…' : 'Prepare & Export Auth Entry'}
                  </button>
                ) : (
                  <div className="space-y-3">
                    <div className="p-4 bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-200 rounded-xl">
                      <p className="text-xs font-bold uppercase tracking-wide text-green-700 mb-2">Auth Entry XDR (Player 1 Signed)</p>
                      <div className="bg-white p-3 rounded-lg border border-green-200 mb-3">
                        <code className="text-xs font-mono text-gray-700 break-all">{exportedAuthEntryXDR}</code>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <button onClick={copyAuthEntryToClipboard} className="py-3 rounded-lg bg-gradient-to-r from-green-500 to-emerald-500 text-white font-bold text-sm transition-all shadow-md hover:scale-105">
                          {authEntryCopied ? '✓ Copied!' : '📋 Copy Auth Entry'}
                        </button>
                        <button onClick={copyShareGameUrlWithAuthEntry} className="py-3 rounded-lg bg-gradient-to-r from-blue-500 to-indigo-500 text-white font-bold text-sm transition-all shadow-md hover:scale-105">
                          {shareUrlCopied ? '✓ Copied!' : '🔗 Share URL'}
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-gray-600 text-center font-semibold">Share the auth entry with Player 2 to finalise the game</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Import mode ── */}
          {createMode === 'import' && (
            <div className="space-y-4">
              <div className="p-4 bg-gradient-to-br from-blue-50 to-cyan-50 border-2 border-blue-200 rounded-xl space-y-3">
                <div>
                  <label className="flex items-center gap-2 text-xs font-bold text-gray-700 mb-1">
                    Auth Entry XDR
                    {xdrParsing && <span className="text-blue-500 animate-pulse">Parsing…</span>}
                    {xdrParseSuccess && <span className="text-green-600">✓ Parsed</span>}
                    {xdrParseError && <span className="text-red-600">✗ Parse failed</span>}
                  </label>
                  <textarea
                    value={importAuthEntryXDR}
                    onChange={(e) => setImportAuthEntryXDR(e.target.value)}
                    placeholder="Paste Player 1's auth entry XDR here…"
                    rows={4}
                    className={`w-full px-4 py-3 rounded-xl bg-white border-2 focus:outline-none focus:ring-4 text-xs font-mono resize-none transition-colors ${
                      xdrParseError ? 'border-red-300 focus:border-red-400 focus:ring-red-100'
                        : xdrParseSuccess ? 'border-green-300 focus:border-green-400 focus:ring-green-100'
                        : 'border-blue-200 focus:border-blue-400 focus:ring-blue-100'
                    }`}
                  />
                  {xdrParseError && <p className="text-xs text-red-600 font-semibold mt-1">{xdrParseError}</p>}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1">Session ID (auto-filled)</label>
                    <input type="text" value={importSessionId} readOnly className="w-full px-4 py-2 rounded-xl bg-gray-50 border-2 border-gray-200 text-xs font-mono text-gray-600 cursor-not-allowed" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1">Player 1 Points (auto-filled)</label>
                    <input type="text" value={importPlayer1Points} readOnly className="w-full px-4 py-2 rounded-xl bg-gray-50 border-2 border-gray-200 text-xs text-gray-600 cursor-not-allowed" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">Player 1 Address (auto-filled)</label>
                  <input type="text" value={importPlayer1} readOnly className="w-full px-4 py-2 rounded-xl bg-gray-50 border-2 border-gray-200 text-xs font-mono text-gray-600 cursor-not-allowed" />
                </div>

                {/* Treasure hash (Player 2 must know it) */}
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    Treasure Hash <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={treasureHashInput}
                    onChange={(e) => setTreasureHashInput(e.target.value)}
                    placeholder="64-char hex — same value Player 1 committed"
                    className="w-full px-4 py-2 rounded-xl bg-white border-2 border-blue-200 focus:outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100 text-xs font-mono"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1">Player 2 (You)</label>
                    <input type="text" value={userAddress} readOnly className="w-full px-4 py-2 rounded-xl bg-gray-50 border-2 border-gray-200 text-xs font-mono text-gray-600 cursor-not-allowed" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">Your Points *</label>
                    <input
                      type="text"
                      value={importPlayer2Points}
                      onChange={(e) => setImportPlayer2Points(e.target.value)}
                      placeholder="e.g. 0.1"
                      className="w-full px-4 py-2 rounded-xl bg-white border-2 border-blue-200 focus:outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100 text-xs"
                    />
                  </div>
                </div>
              </div>

              <button
                onClick={handleImportTransaction}
                disabled={isBusy || !importAuthEntryXDR.trim() || !importPlayer2Points.trim()}
                className="w-full py-4 rounded-xl font-bold text-white text-lg bg-gradient-to-r from-blue-500 via-cyan-500 to-teal-500 hover:from-blue-600 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500 transition-all shadow-xl hover:shadow-2xl transform hover:scale-105 disabled:transform-none"
              >
                {loading ? 'Importing & Signing…' : 'Import & Sign Auth Entry'}
              </button>
            </div>
          )}

          {/* ── Load mode ── */}
          {createMode === 'load' && (
            <div className="space-y-4">
              <div className="p-4 bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-200 rounded-xl">
                <p className="text-sm font-semibold text-green-800 mb-2">🎮 Load Existing Game by Session ID</p>
                <input
                  type="text"
                  value={loadSessionId}
                  onChange={(e) => setLoadSessionId(e.target.value)}
                  placeholder="Enter session ID"
                  className="w-full px-4 py-3 rounded-xl bg-white border-2 border-green-200 focus:outline-none focus:border-green-400 focus:ring-4 focus:ring-green-100 text-sm font-mono"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  onClick={handleLoadExistingGame}
                  disabled={isBusy || !loadSessionId.trim()}
                  className="py-4 rounded-xl font-bold text-white text-lg bg-gradient-to-r from-green-500 to-emerald-500 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500 transition-all shadow-xl hover:shadow-2xl transform hover:scale-105 disabled:transform-none"
                >
                  {loading ? 'Loading…' : '🎮 Load Game'}
                </button>
                <button
                  onClick={copyShareGameUrlWithSessionId}
                  disabled={!loadSessionId.trim()}
                  className="py-4 rounded-xl font-bold text-white text-lg bg-gradient-to-r from-blue-500 to-indigo-500 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500 transition-all shadow-xl hover:shadow-2xl transform hover:scale-105 disabled:transform-none"
                >
                  {shareUrlCopied ? '✓ Copied!' : '🔗 Share Game'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          PROVE PHASE — Player generates + submits ZK proof
          ══════════════════════════════════════════════════════════════════════ */}
      {gamePhase === 'prove' && gameState && (
        <div className="space-y-6">
          {/* Player cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[{ key: 'player1', label: 'Player 1', isMe: !!isPlayer1, energy: gameState.player1_energy },
              { key: 'player2', label: 'Player 2', isMe: !!isPlayer2, energy: gameState.player2_energy }].map(
              ({ key, label, isMe, energy }) => (
                <div key={key} className={`p-5 rounded-xl border-2 ${isMe ? 'border-purple-400 bg-gradient-to-br from-purple-50 to-pink-50 shadow-lg' : 'border-gray-200 bg-white'}`}>
                  <div className="text-xs font-bold uppercase tracking-wide text-gray-600 mb-1">{label} {isMe && '(You)'}</div>
                  <div className="font-mono text-sm font-semibold mb-2 text-gray-800">
                    {(gameState as any)[key].slice(0, 8)}…{(gameState as any)[key].slice(-4)}
                  </div>
                  <div className="mt-2">
                    {energy !== null && energy !== undefined ? (
                      <span className="inline-block px-3 py-1 rounded-full bg-gradient-to-r from-green-400 to-emerald-500 text-white text-xs font-bold shadow-md">
                        ✓ Proof Submitted
                      </span>
                    ) : (
                      <span className="inline-block px-3 py-1 rounded-full bg-gray-200 text-gray-600 text-xs font-bold">
                        Awaiting proof…
                      </span>
                    )}
                  </div>
                </div>
              )
            )}
          </div>

          {/* ZK proof generation — only if current player hasn't submitted yet */}
          {(isPlayer1 || isPlayer2) && !myProofSubmitted && (
            <div className="p-5 bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 border-2 border-indigo-200 rounded-2xl space-y-4">
              <div>
                <h3 className="text-lg font-black text-gray-900 mb-1">🔐 Submit Your ZK Proof</h3>
                <p className="text-xs text-gray-600 font-semibold">
                  Treasure hash on-chain:{' '}
                  <code className="text-indigo-700">{treasureHashHex ? `0x${treasureHashHex.slice(0, 16)}…` : 'loading…'}</code>
                </p>
              </div>

              <ZkProofSection
                treasureHash={treasureHashHex ? `0x${treasureHashHex}` : '0x0000000000000000000000000000000000000000000000000000000000000000'}
                onProofReady={handleProofReady}
                disabled={isBusy}
              />

              {proofReady && pendingProof && (
                <button
                  id="submit-zk-proof-btn"
                  onClick={handleSubmitProof}
                  disabled={isBusy}
                  className="w-full py-4 rounded-xl font-bold text-white text-sm bg-gradient-to-r from-green-500 via-emerald-500 to-teal-500 hover:from-green-600 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500 transition-all shadow-lg hover:shadow-xl transform hover:scale-105 disabled:transform-none"
                >
                  {loading ? '⏳ Submitting to Soroban…' : '📤 Submit Proof to Contract'}
                </button>
              )}
            </div>
          )}

          {myProofSubmitted && (
            <div className="p-4 bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-200 rounded-xl">
              <p className="text-sm font-semibold text-green-700">
                ✓ Your proof has been submitted. Waiting for the other player, then resolve the game.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          RESOLVE PHASE
          ══════════════════════════════════════════════════════════════════════ */}
      {gamePhase === 'resolve' && gameState && (
        <div className="space-y-6">
          <div className="p-8 bg-gradient-to-br from-yellow-50 via-orange-50 to-amber-50 border-2 border-yellow-300 rounded-2xl text-center shadow-xl">
            <div className="text-6xl mb-4">🏁</div>
            <h3 className="text-2xl font-black text-gray-900 mb-3">Proofs Submitted!</h3>
            <p className="text-sm font-semibold text-gray-700 mb-2">
              P1 proof: {p1SubmittedProof ? <span className="text-green-600">✓</span> : <span className="text-gray-400">pending</span>}
              &nbsp;|&nbsp;
              P2 proof: {p2SubmittedProof ? <span className="text-green-600">✓</span> : <span className="text-gray-400">pending</span>}
            </p>
            <p className="text-xs font-semibold text-gray-600 mb-6">
              Anyone can call resolve — lower energy_used wins.
            </p>
            <button
              id="resolve-game-btn"
              onClick={handleResolveGame}
              disabled={isBusy}
              className="px-10 py-4 rounded-xl font-bold text-white text-lg bg-gradient-to-r from-yellow-500 via-orange-500 to-amber-500 hover:from-yellow-600 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500 transition-all shadow-xl hover:shadow-2xl transform hover:scale-105 disabled:transform-none"
            >
              {loading ? 'Resolving…' : '⚖️ Resolve Game'}
            </button>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          COMPLETE PHASE
          ══════════════════════════════════════════════════════════════════════ */}
      {gamePhase === 'complete' && (
        <div className="space-y-6">
          <div className="p-10 bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 border-2 border-green-300 rounded-2xl text-center shadow-2xl">
            <div className="text-7xl mb-6">🏆</div>
            <h3 className="text-3xl font-black text-gray-900 mb-4">Game Complete!</h3>
            {outcome && (
              <div className="text-xl font-black text-green-700 mb-6">
                {outcomeLabel[outcome.tag] ?? outcome.tag}
              </div>
            )}
            <div className="space-y-3 mb-6">
              {gameState && (
                <>
                  <div className="p-4 bg-white/70 border border-green-200 rounded-xl">
                    <p className="text-xs font-bold uppercase tracking-wide text-gray-600 mb-1">Player 1</p>
                    <p className="font-mono text-xs text-gray-700 mb-1">{gameState.player1.slice(0, 8)}…{gameState.player1.slice(-4)}</p>
                    <p className="text-sm font-semibold text-gray-800">
                      Energy: {gameState.player1_energy !== null && gameState.player1_energy !== undefined ? gameState.player1_energy : '—'}
                    </p>
                  </div>
                  <div className="p-4 bg-white/70 border border-green-200 rounded-xl">
                    <p className="text-xs font-bold uppercase tracking-wide text-gray-600 mb-1">Player 2</p>
                    <p className="font-mono text-xs text-gray-700 mb-1">{gameState.player2.slice(0, 8)}…{gameState.player2.slice(-4)}</p>
                    <p className="text-sm font-semibold text-gray-800">
                      Energy: {gameState.player2_energy !== null && gameState.player2_energy !== undefined ? gameState.player2_energy : '—'}
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
          <button
            onClick={handleStartNewGame}
            className="w-full py-4 rounded-xl font-bold text-gray-700 bg-gradient-to-r from-gray-200 to-gray-300 hover:from-gray-300 hover:to-gray-400 transition-all shadow-lg hover:shadow-xl transform hover:scale-105"
          >
            Start New Game
          </button>
        </div>
      )}
    </div>
  );
}
