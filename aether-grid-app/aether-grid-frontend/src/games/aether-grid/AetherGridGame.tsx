import { useState, useEffect, useRef } from 'react';
import { Buffer } from 'buffer';
import { BarretenbergSync, Fr } from '@aztec/bb.js';
import { AetherGridService } from './aetherGridService';
import { requestCache, createCacheKey } from '@/utils/requestCache';
import { useWallet } from '@/hooks/useWallet';
import { AETHER_GRID_CONTRACT } from '@/utils/constants';
import { getFundedSimulationSourceAddress } from '@/utils/simulationUtils';
import { devWalletService, DevWalletService } from '@/services/devWalletService';
import { AetherGame } from '@/components/aether-board';
import {
  useAetherGameStore,
  persistSessionState,
  restoreSessionState,
  clearSessionStorage,
  getHiddenObjectTileForSession,
} from '@/components/aether-board/game/gameStore';
import { useGameRoleStore } from '@/stores/gameRoleStore';
import { ZkProofSection } from './ZkProofSection';
import type { ZkProofResult } from './ZkProofSection';
import type { Game, Outcome } from './bindings';
import { zkLog } from './zkLogger';

/** Convert a Buffer (32 bytes) to a hex string without 0x prefix. */
function bufferToHex(buf: Buffer): string {
  return buf.toString('hex');
}

const PERSIST_DEBOUNCE_MS = 400;

function useDebouncedPersist() {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const unsub = useAetherGameStore.subscribe(() => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        persistSessionState();
        timeoutRef.current = null;
      }, PERSIST_DEBOUNCE_MS);
    });
    return () => {
      unsub();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);
}

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

// Create service instance with the contract ID
const aetherGridService = new AetherGridService(AETHER_GRID_CONTRACT);

interface AetherGridGameProps {
  userAddress: string;
  currentEpoch?: number;
  availablePoints: bigint;
  initialXDR?: string | null;
  initialSessionId?: number | null;
  onStandingsRefresh: () => void;
  onGameComplete: () => void;
}

export function AetherGridGame({
  userAddress,
  availablePoints,
  initialXDR,
  initialSessionId,
  onStandingsRefresh,
  onGameComplete
}: AetherGridGameProps) {
  const DEFAULT_POINTS = '0.1';
  const { getContractSigner, walletType } = useWallet();
  const boardPhase = useAetherGameStore((s) => s.phase);
  const boardEnergy = useAetherGameStore((s) => s.energy);
  // Use a random session ID that fits in u32 (avoid 0 because UI validation treats <=0 as invalid)
  const [sessionId, setSessionId] = useState<number>(() => createRandomSessionId());
  const [player1Address, setPlayer1Address] = useState(userAddress);
  const [player1Points, setPlayer1Points] = useState(DEFAULT_POINTS);
  const [gameState, setGameState] = useState<Game | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [loading, setLoading] = useState(false);
  const [quickstartLoading, setQuickstartLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // gamePhase: create → game session initiated
  //            guess  → AetherGame board navigation
  //            prove  → ZK proof generation (after board finishes)
  //            resolve → proof submitted, awaiting resolve_game
  //            complete → game resolved
  const [gamePhase, setGamePhase] = useState<'create' | 'guess' | 'prove' | 'resolve' | 'complete'>('create');
  const [createMode, setCreateMode] = useState<'create' | 'import' | 'load'>('create');
  // ZK proof
  const [treasureHashHex, setTreasureHashHex] = useState('');
  const [boardEnergyForProof, setBoardEnergyForProof] = useState(0);
  const [proofReady, setProofReady] = useState(false);
  const [pendingProof, setPendingProof] = useState<ZkProofResult | null>(null);
  const [proofSubmitted, setProofSubmitted] = useState(false);
  // Treasure private inputs — generated at game-creation time
  const [treasureX, setTreasureX] = useState(0);
  const [treasureY, setTreasureY] = useState(0);
  const [treasureNullifier, setTreasureNullifier] = useState(0);
  const [exportedAuthEntryXDR, setExportedAuthEntryXDR] = useState<string | null>(null);
  const [importAuthEntryXDR, setImportAuthEntryXDR] = useState('');
  const [importSessionId, setImportSessionId] = useState('');
  const [importPlayer1, setImportPlayer1] = useState('');
  const [importPlayer1Points, setImportPlayer1Points] = useState('');
  const [importPlayer2Points, setImportPlayer2Points] = useState(DEFAULT_POINTS);
  const [loadSessionId, setLoadSessionId] = useState('');
  const [authEntryCopied, setAuthEntryCopied] = useState(false);
  const [shareUrlCopied, setShareUrlCopied] = useState(false);
  const [xdrParsing, setXdrParsing] = useState(false);
  const [xdrParseError, setXdrParseError] = useState<string | null>(null);
  const [xdrParseSuccess, setXdrParseSuccess] = useState(false);

  useEffect(() => {
    setPlayer1Address(userAddress);
  }, [userAddress]);

  useEffect(() => {
    if (createMode === 'import' && !importPlayer2Points.trim()) {
      setImportPlayer2Points(DEFAULT_POINTS);
    }
  }, [createMode, importPlayer2Points]);

  const POINTS_DECIMALS = 7;
  const isBusy = loading || quickstartLoading;
  const actionLock = useRef(false);
  const quickstartAvailable = walletType === 'dev'
    && DevWalletService.isDevModeAvailable()
    && DevWalletService.isPlayerAvailable(1)
    && DevWalletService.isPlayerAvailable(2);

  const runAction = async (action: () => Promise<void>) => {
    if (actionLock.current || isBusy) {
      return;
    }
    actionLock.current = true;
    try {
      await action();
    } finally {
      actionLock.current = false;
    }
  };

  const handleStartNewGame = () => {
    if (gameState?.resolved) {
      onGameComplete();
    }

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
    // ZK proof reset
    setTreasureHashHex('');
    setBoardEnergyForProof(0);
    setProofReady(false);
    setPendingProof(null);
    setProofSubmitted(false);
    setTreasureX(0);
    setTreasureY(0);
    setTreasureNullifier(0);
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

  const loadGameState = async () => {
    try {
      requestCache.invalidate(createCacheKey('game-state', sessionId));
      const game = await aetherGridService.getGame(sessionId);
      setGameState(game);

      if (!game) return;

      // Progress game phase based on ZK proof submission state.
      // Only the player who has already submitted their own proof (or both players
      // have submitted) should be moved to 'resolve'. If only the *opponent* has
      // submitted, the current player stays in 'guess'/'prove' so they can finish
      // the board and generate their own proof. The opponent's status card in the
      // combat UI is updated live via the polled `gameState` regardless.
      if (game.resolved) {
        setGamePhase('complete');
      } else if (game.player1_energy !== null || game.player2_energy !== null) {
        const currentIsPlayer1 = game.player1 === userAddress;
        const currentIsPlayer2 = game.player2 === userAddress;
        const currentUserSubmitted =
          (currentIsPlayer1 && game.player1_energy !== null) ||
          (currentIsPlayer2 && game.player2_energy !== null);
        const bothSubmitted = game.player1_energy !== null && game.player2_energy !== null;
        // Move to resolve only when the current user has submitted, or if they are
        // an observer (neither player 1 nor player 2), or when both players have submitted.
        const shouldResolve = currentUserSubmitted || bothSubmitted || (!currentIsPlayer1 && !currentIsPlayer2);
        if (shouldResolve) {
          setGamePhase((prev) => (prev === 'guess' || prev === 'prove' ? 'resolve' : prev));
        }
      }

      // Fetch treasure hash from on-chain if we don't have it yet
      if (!treasureHashHex) {
        const hash = await aetherGridService.getTreasureHash(sessionId);
        if (hash) setTreasureHashHex(bufferToHex(hash));
      }
    } catch {
      setGameState(null);
    }
  };

  useEffect(() => {
    if (gamePhase !== 'create') {
      loadGameState();
      const interval = setInterval(loadGameState, 5000); // Poll every 5 seconds
      return () => clearInterval(interval);
    }
  }, [sessionId, gamePhase]);

  const prevUserAddressRef = useRef<string | null>(null);
  useEffect(() => {
    if (sessionId && gamePhase !== 'create' && prevUserAddressRef.current !== null && prevUserAddressRef.current !== userAddress) {
      setError(null);
      setSuccess(null);
      setLoading(false);
      lastGuessInitRef.current = null;
      // Resetear tablero de inmediato para no enviar la energía del jugador anterior al hacer onFinish
      const g = gameStateRef.current;
      if (g?.player1 != null && g?.player2 != null) {
        const playerNumber = g.player1 === userAddress ? 1 : 2;
        const store = useAetherGameStore.getState();
        store.reset();
        store.initMatchGame(sessionId, playerNumber);
        skipNextFinishRef.current = true;
      }
      loadGameState();
    }
    prevUserAddressRef.current = userAddress;
  }, [userAddress, sessionId, gamePhase]);

  // Persistir estado en memoria al cambiar (para no perder progreso al cambiar de wallet)
  useDebouncedPersist();

  const gameStateRef = useRef<Game | null>(gameState);
  gameStateRef.current = gameState;
  const revealPollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (revealPollIntervalRef.current) {
        clearInterval(revealPollIntervalRef.current);
        revealPollIntervalRef.current = null;
      }
    };
  }, []);

  const skipNextFinishRef = useRef(false);

  // Reset síncrono del tablero al cambiar de wallet (en el mismo render, antes de que AetherGame lea el store).
  // Así evitamos que onFinish(energy) se dispare con la energía del jugador anterior. No actualizamos prevUserAddressRef aquí para que el efecto de cambio de wallet siga llamando loadGameState().
  if (sessionId && gamePhase !== 'create' && prevUserAddressRef.current !== null && prevUserAddressRef.current !== userAddress) {
    const g = gameStateRef.current;
    if (g?.player1 != null && g?.player2 != null) {
      const pn = g.player1 === userAddress ? 1 : 2;
      const store = useAetherGameStore.getState();
      store.reset();
      store.initMatchGame(sessionId, pn);
      store.startGame();
      skipNextFinishRef.current = true;
    }
  }

  // Solo al ENTRAR en fase guess (cambio de sesión o de wallet): restaurar o iniciar. No re-ejecutar cuando gameState se actualiza por polling (cada 5s) para no sobrescribir movimientos.
  const lastGuessInitRef = useRef<string | null>(null);
  useEffect(() => {
    if (gamePhase !== 'guess' || !sessionId) return;
    const key = `${sessionId}-${userAddress}`;
    if (lastGuessInitRef.current === key) return;
    lastGuessInitRef.current = key;
    const gameStateCurrent = gameStateRef.current;
    if (!gameStateCurrent) return;
    const playerNumber = gameStateCurrent.player1 === userAddress ? 1 : 2;
    const restored = restoreSessionState(sessionId, playerNumber);
    const store = useAetherGameStore.getState();
    if (restored) {
      if (restored.phase === 'FINISHED') skipNextFinishRef.current = true;
      store.restoreState(restored);
      if (restored.phase === 'IDLE') store.startGame();
    } else {
      store.reset();
      store.initMatchGame(sessionId, playerNumber);
      store.startGame();
    }
  }, [gamePhase, sessionId, userAddress, gameState]);

  // Auto-refresh standings when game completes
  useEffect(() => {
    if (gamePhase === 'complete' && gameState?.resolved) {
      console.log('Game completed! Refreshing standings...');
      onStandingsRefresh();
    }
  }, [gamePhase, gameState?.resolved]);

  // Handle initial values from URL deep linking or props
  // Expected URL formats:
  //   - With auth entry: ?game=aether-grid&auth=AAAA... (Session ID, P1 address, P1 points parsed from auth entry)
  //   - With session ID: ?game=aether-grid&session-id=123 (Load existing game)
  // Note: GamesCatalog cleans URL params, so we prioritize props over URL
  useEffect(() => {
    // Priority 1: Check initialXDR prop (from GamesCatalog after URL cleanup)
    if (initialXDR) {
      console.log('[Deep Link] Using initialXDR prop from GamesCatalog');

      try {
        const parsed = aetherGridService.parseAuthEntry(initialXDR);
        const sessionId = parsed.sessionId;

        console.log('[Deep Link] Parsed session ID from initialXDR:', sessionId);

        // Check if game already exists (both players have signed)
        aetherGridService.getGame(sessionId)
          .then((game) => {
            if (game) {
              // Game exists! Load it directly instead of going to import mode
              console.log('[Deep Link] Game already exists, loading directly to guess phase');
              console.log('[Deep Link] Game data:', game);

              // Auto-load the game - bypass create phase entirely
              setGameState(game);
              setGamePhase('guess');
              setSessionId(sessionId); // Set session ID for the game
            } else {
              // Game doesn't exist yet, go to import mode
              console.log('[Deep Link] Game not found, entering import mode');
              setCreateMode('import');
              setImportAuthEntryXDR(initialXDR);
              setImportSessionId(sessionId.toString());
              setImportPlayer1(parsed.player1);
              setImportPlayer1Points((Number(parsed.player1Points) / 10_000_000).toString());
              setImportPlayer2Points('0.1');
            }
          })
          .catch((err) => {
            console.error('[Deep Link] Error checking game existence:', err);
            console.error('[Deep Link] Error details:', {
              message: err?.message,
              stack: err?.stack,
              sessionId: sessionId,
            });
            // If we can't check, default to import mode
            setCreateMode('import');
            setImportAuthEntryXDR(initialXDR);
            setImportSessionId(parsed.sessionId.toString());
            setImportPlayer1(parsed.player1);
            setImportPlayer1Points((Number(parsed.player1Points) / 10_000_000).toString());
            setImportPlayer2Points('0.1');
          });
      } catch (err) {
        console.log('[Deep Link] Failed to parse initialXDR, will retry on import');
        setCreateMode('import');
        setImportAuthEntryXDR(initialXDR);
        setImportPlayer2Points('0.1');
      }
      return; // Exit early - we processed initialXDR
    }

    // Priority 2: Check URL parameters (for direct navigation without GamesCatalog)
    const urlParams = new URLSearchParams(window.location.search);
    const authEntry = urlParams.get('auth');
    const urlSessionId = urlParams.get('session-id');

    if (authEntry) {
      // Simplified URL format - only auth entry is needed
      // Session ID, Player 1 address, and points are parsed from auth entry
      console.log('[Deep Link] Auto-populating game from URL with auth entry');

      // Try to parse auth entry to get session ID
      try {
        const parsed = aetherGridService.parseAuthEntry(authEntry);
        const sessionId = parsed.sessionId;

        console.log('[Deep Link] Parsed session ID from URL auth entry:', sessionId);

        // Check if game already exists (both players have signed)
        aetherGridService.getGame(sessionId)
          .then((game) => {
            if (game) {
              // Game exists! Load it directly instead of going to import mode
              console.log('[Deep Link] Game already exists (URL), loading directly to guess phase');
              console.log('[Deep Link] Game data:', game);

              // Auto-load the game - bypass create phase entirely
              setGameState(game);
              setGamePhase('guess');
              setSessionId(sessionId); // Set session ID for the game
            } else {
              // Game doesn't exist yet, go to import mode
              console.log('[Deep Link] Game not found (URL), entering import mode');
              setCreateMode('import');
              setImportAuthEntryXDR(authEntry);
              setImportSessionId(sessionId.toString());
              setImportPlayer1(parsed.player1);
              setImportPlayer1Points((Number(parsed.player1Points) / 10_000_000).toString());
              setImportPlayer2Points('0.1');
            }
          })
          .catch((err) => {
            console.error('[Deep Link] Error checking game existence (URL):', err);
            console.error('[Deep Link] Error details:', {
              message: err?.message,
              stack: err?.stack,
              sessionId: sessionId,
            });
            // If we can't check, default to import mode
            setCreateMode('import');
            setImportAuthEntryXDR(authEntry);
            setImportSessionId(parsed.sessionId.toString());
            setImportPlayer1(parsed.player1);
            setImportPlayer1Points((Number(parsed.player1Points) / 10_000_000).toString());
            setImportPlayer2Points('0.1');
          });
      } catch (err) {
        console.log('[Deep Link] Failed to parse auth entry from URL, will retry on import');
        setCreateMode('import');
        setImportAuthEntryXDR(authEntry);
        setImportPlayer2Points('0.1');
      }
    } else if (urlSessionId) {
      // Load existing game by session ID
      console.log('[Deep Link] Auto-populating game from URL with session ID');
      setCreateMode('load');
      setLoadSessionId(urlSessionId);
    } else if (initialSessionId !== null && initialSessionId !== undefined) {
      console.log('[Deep Link] Auto-populating session ID from prop:', initialSessionId);
      setCreateMode('load');
      setLoadSessionId(initialSessionId.toString());
    }
  }, [initialXDR, initialSessionId]);

  // Auto-parse Auth Entry XDR when pasted
  useEffect(() => {
    // Only parse if in import mode and XDR is not empty
    if (createMode !== 'import' || !importAuthEntryXDR.trim()) {
      // Reset parse states when XDR is cleared
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

    // Auto-parse the XDR
    const parseXDR = async () => {
      setXdrParsing(true);
      setXdrParseError(null);
      setXdrParseSuccess(false);

      try {
        console.log('[Auto-Parse] Parsing auth entry XDR...');
        const gameParams = aetherGridService.parseAuthEntry(importAuthEntryXDR.trim());

        // Check if user is trying to import their own auth entry (self-play prevention)
        if (gameParams.player1 === userAddress) {
          throw new Error('You cannot play against yourself. This auth entry was created by you (Player 1).');
        }

        // Successfully parsed - auto-fill fields
        setImportSessionId(gameParams.sessionId.toString());
        setImportPlayer1(gameParams.player1);
        setImportPlayer1Points((Number(gameParams.player1Points) / 10_000_000).toString());
        setXdrParseSuccess(true);
        console.log('[Auto-Parse] Successfully parsed auth entry:', {
          sessionId: gameParams.sessionId,
          player1: gameParams.player1,
          player1Points: (Number(gameParams.player1Points) / 10_000_000).toString(),
        });
      } catch (err) {
        console.error('[Auto-Parse] Failed to parse auth entry:', err);
        const errorMsg = err instanceof Error ? err.message : 'Invalid auth entry XDR';
        setXdrParseError(errorMsg);
        // Clear auto-filled fields on error
        setImportSessionId('');
        setImportPlayer1('');
        setImportPlayer1Points('');
      } finally {
        setXdrParsing(false);
      }
    };

    // Debounce parsing to avoid parsing on every keystroke
    const timeoutId = setTimeout(parseXDR, 500);
    return () => clearTimeout(timeoutId);
  }, [importAuthEntryXDR, createMode, userAddress]);

  const handlePrepareTransaction = async () => {
    await runAction(async () => {
      try {
        setLoading(true);
        setError(null);
        setSuccess(null);

        const p1Points = parsePoints(player1Points);

        if (!p1Points || p1Points <= 0n) {
          throw new Error('Enter a valid points amount');
        }

        const signer = getContractSigner();

        // Use placeholder values for Player 2 (they'll rebuild with their own values).
        // We still need a real, funded account as the transaction source for build/simulation.
        const placeholderPlayer2Address = await getFundedSimulationSourceAddress([player1Address, userAddress]);
        const placeholderP2Points = p1Points; // Same as P1 for simulation

        // Derive treasure position deterministically from sessionId and compute
        // its Poseidon2 hash to commit on-chain. The nullifier is the session ID
        // itself (non-cryptographic; security can be improved later).
        const tile = getHiddenObjectTileForSession(sessionId);
        const txX = Math.floor(tile.x);
        const txY = Math.floor(tile.y);
        const txNullifier = sessionId >>> 0; // u32
        const bbApi = await BarretenbergSync.initSingleton();
        const hashFr = bbApi.poseidon2Hash([new Fr(BigInt(txX)), new Fr(BigInt(txY)), new Fr(BigInt(txNullifier))]);
        const hashHex = hashFr.toString().replace(/^0x/, '').padStart(64, '0');
        const treasureHash = Buffer.from(hashHex, 'hex');

        // Store private inputs in state so ZkProofSection can use them later.
        setTreasureHashHex(hashHex);
        setTreasureX(txX);
        setTreasureY(txY);
        setTreasureNullifier(txNullifier);

        console.log('Preparing transaction for Player 1 to sign...');
        console.log('Using placeholder Player 2 values for simulation only');
        console.log(`Treasure tile: (${txX}, ${txY}), nullifier: ${txNullifier}, hash: ${hashHex}`);
        const authEntryXDR = await aetherGridService.prepareStartGame(
          sessionId,
          player1Address,
          placeholderPlayer2Address,
          p1Points,
          placeholderP2Points,
          treasureHash,
          signer
        );

        console.log('Transaction prepared successfully! Player 1 has signed their auth entry.');
        setExportedAuthEntryXDR(authEntryXDR);
        setSuccess('Signature ready. Copy the XDR or URL and send it to Player 2. Waiting for the other player to start...');

        // Start polling for the game to be created by Player 2
        const pollInterval = setInterval(async () => {
          try {
            // Try to load the game
            const game = await aetherGridService.getGame(sessionId);
            if (game) {
              console.log('Game found! Player 2 has finalized the transaction. Transitioning to guess phase...');
              clearInterval(pollInterval);

              // Update game state
              setGameState(game);
              setExportedAuthEntryXDR(null);
              setSuccess('Game created! Player 2 has signed and submitted.');
              setGamePhase('guess');

              // Refresh dashboard to show updated available points (locked in game)
              onStandingsRefresh();

              // Clear success message after 2 seconds
              setTimeout(() => setSuccess(null), 2000);
            } else {
              console.log('Game not found yet, continuing to poll...');
            }
          } catch (err) {
            // Game doesn't exist yet, keep polling
            console.log('Polling for game creation...', err instanceof Error ? err.message : 'checking');
          }
        }, 3000); // Poll every 3 seconds

        // Stop polling after 5 minutes
        setTimeout(() => {
          clearInterval(pollInterval);
          console.log('Stopped polling after 5 minutes');
        }, 300000);
      } catch (err) {
        console.error('Prepare transaction error:', err);
        // Extract detailed error message
        let errorMessage = 'Failed to prepare transaction';
        if (err instanceof Error) {
          errorMessage = err.message;

          // Check for common errors
          if (err.message.includes('insufficient')) {
            errorMessage = `Insufficient points: ${err.message}. Make sure you have enough points for this game.`;
          } else if (err.message.includes('auth')) {
            errorMessage = `Authorization failed: ${err.message}. Check your wallet connection.`;
          }
        }

        setError(errorMessage);

        // Keep the component in 'create' phase so user can see the error and retry
      } finally {
        setLoading(false);
      }
    });
  };

  const handleQuickStart = async () => {
    await runAction(async () => {
      try {
        setQuickstartLoading(true);
        setError(null);
        setSuccess(null);
        if (walletType !== 'dev') {
          throw new Error('Quickstart only works with dev wallets in the Games Library.');
        }

        if (!DevWalletService.isDevModeAvailable() || !DevWalletService.isPlayerAvailable(1) || !DevWalletService.isPlayerAvailable(2)) {
          throw new Error('Quickstart requires both dev wallets. Run "bun run setup" and connect a dev wallet.');
        }

        const p1Points = parsePoints(player1Points);
        if (!p1Points || p1Points <= 0n) {
          throw new Error('Enter a valid points amount');
        }

        const originalPlayer = devWalletService.getCurrentPlayer();
        let player1AddressQuickstart = '';
        let player2AddressQuickstart = '';
        let player1Signer: ReturnType<typeof devWalletService.getSigner> | null = null;
        let player2Signer: ReturnType<typeof devWalletService.getSigner> | null = null;

        try {
          await devWalletService.initPlayer(1);
          player1AddressQuickstart = devWalletService.getPublicKey();
          player1Signer = devWalletService.getSigner();

          await devWalletService.initPlayer(2);
          player2AddressQuickstart = devWalletService.getPublicKey();
          player2Signer = devWalletService.getSigner();
        } finally {
          if (originalPlayer) {
            await devWalletService.initPlayer(originalPlayer);
          }
        }

        if (!player1Signer || !player2Signer) {
          throw new Error('Quickstart failed to initialize dev wallet signers.');
        }

        if (player1AddressQuickstart === player2AddressQuickstart) {
          throw new Error('Quickstart requires two different dev wallets.');
        }

        const quickstartSessionId = createRandomSessionId();
        setSessionId(quickstartSessionId);
        setPlayer1Address(player1AddressQuickstart);
        setCreateMode('create');
        setExportedAuthEntryXDR(null);
        setImportAuthEntryXDR('');
        setImportSessionId('');
        setImportPlayer1('');
        setImportPlayer1Points('');
        setImportPlayer2Points(DEFAULT_POINTS);
        setLoadSessionId('');

        const placeholderPlayer2Address = await getFundedSimulationSourceAddress([
          player1AddressQuickstart,
          player2AddressQuickstart,
        ]);

        // Derive treasure position deterministically and compute Poseidon2 hash.
        const qsTile = getHiddenObjectTileForSession(quickstartSessionId);
        const qsX = Math.floor(qsTile.x);
        const qsY = Math.floor(qsTile.y);
        const qsNullifier = quickstartSessionId >>> 0;
        const qsBbApi = await BarretenbergSync.initSingleton();
        const qsHashFr = qsBbApi.poseidon2Hash([new Fr(BigInt(qsX)), new Fr(BigInt(qsY)), new Fr(BigInt(qsNullifier))]);
        const qsHashHex = qsHashFr.toString().replace(/^0x/, '').padStart(64, '0');
        const qsTreasureHash = Buffer.from(qsHashHex, 'hex');

        // Store private inputs in state so ZkProofSection can use them later.
        setTreasureHashHex(qsHashHex);
        setTreasureX(qsX);
        setTreasureY(qsY);
        setTreasureNullifier(qsNullifier);

        console.log(`[Quickstart] Treasure tile: (${qsX}, ${qsY}), nullifier: ${qsNullifier}, hash: ${qsHashHex}`);

        const authEntryXDR = await aetherGridService.prepareStartGame(
          quickstartSessionId,
          player1AddressQuickstart,
          placeholderPlayer2Address,
          p1Points,
          p1Points,
          qsTreasureHash,
          player1Signer
        );

        const fullySignedTxXDR = await aetherGridService.importAndSignAuthEntry(
          authEntryXDR,
          player2AddressQuickstart,
          p1Points,
          qsTreasureHash,
          player2Signer
        );

        await aetherGridService.finalizeStartGame(
          fullySignedTxXDR,
          player2AddressQuickstart,
          player2Signer
        );

        try {
          const game = await aetherGridService.getGame(quickstartSessionId);
          setGameState(game);
        } catch (err) {
          console.log('Quickstart game not available yet:', err);
        }
        setGamePhase('guess');
        onStandingsRefresh();
        setSuccess('Quickstart complete! Both players signed and the game is ready.');
        setTimeout(() => setSuccess(null), 2000);
      } catch (err) {
        console.error('Quickstart error:', err);
        setError(err instanceof Error ? err.message : 'Quickstart failed');
      } finally {
        setQuickstartLoading(false);
      }
    });
  };

  const handleImportTransaction = async () => {
    await runAction(async () => {
      try {
        setLoading(true);
        setError(null);
        setSuccess(null);
        // Validate required inputs (only auth entry and player 2 points)
        if (!importAuthEntryXDR.trim()) {
          throw new Error('Enter auth entry XDR from Player 1');
        }
        if (!importPlayer2Points.trim()) {
          throw new Error('Enter your points amount (Player 2)');
        }

        // Parse Player 2's points
        const p2Points = parsePoints(importPlayer2Points);
        if (!p2Points || p2Points <= 0n) {
          throw new Error('Invalid Player 2 points');
        }

        // Parse auth entry to extract game parameters
        // The auth entry contains: session_id, player1, player1_points
        console.log('Parsing auth entry to extract game parameters...');
        const gameParams = aetherGridService.parseAuthEntry(importAuthEntryXDR.trim());

        console.log('Extracted from auth entry:', {
          sessionId: gameParams.sessionId,
          player1: gameParams.player1,
          player1Points: gameParams.player1Points.toString(),
        });

        // Auto-populate read-only fields from parsed auth entry (for display)
        setImportSessionId(gameParams.sessionId.toString());
        setImportPlayer1(gameParams.player1);
        setImportPlayer1Points((Number(gameParams.player1Points) / 10_000_000).toString());

        // Verify the user is Player 2 (prevent self-play)
        if (gameParams.player1 === userAddress) {
          throw new Error('Invalid game: You cannot play against yourself (you are Player 1 in this auth entry)');
        }

        // Additional validation: Ensure Player 2 address is different from Player 1
        // (In case user manually edits the Player 2 field)
        if (userAddress === gameParams.player1) {
          throw new Error('Cannot play against yourself. Player 2 must be different from Player 1.');
        }

        const signer = getContractSigner();

        // Player 2 must use the SAME treasure_hash that Player 1 committed.
        // Since the hash is deterministic (derived from session ID), we recompute it here.
        const importedTile = getHiddenObjectTileForSession(gameParams.sessionId);
        const importedX = Math.floor(importedTile.x);
        const importedY = Math.floor(importedTile.y);
        const importedNullifier = gameParams.sessionId >>> 0;
        const importBbApi = await BarretenbergSync.initSingleton();
        const importHashFr = importBbApi.poseidon2Hash([
          new Fr(BigInt(importedX)),
          new Fr(BigInt(importedY)),
          new Fr(BigInt(importedNullifier)),
        ]);
        const importHashHex = importHashFr.toString().replace(/^0x/, '').padStart(64, '0');
        const importTreasureHash = Buffer.from(importHashHex, 'hex');

        // Store private inputs in state so ZkProofSection has them when the prove phase starts.
        setTreasureHashHex(importHashHex);
        setTreasureX(importedX);
        setTreasureY(importedY);
        setTreasureNullifier(importedNullifier);

        console.log(`[Import] Treasure tile: (${importedX}, ${importedY}), nullifier: ${importedNullifier}, hash: ${importHashHex}`);

        // Step 1: Import Player 1's signed auth entry and rebuild transaction
        // New simplified API - only needs: auth entry, player 2 address, player 2 points
        console.log('Importing Player 1 auth entry and rebuilding transaction...');

        const fullySignedTxXDR = await aetherGridService.importAndSignAuthEntry(
          importAuthEntryXDR.trim(),
          userAddress, // Player 2 address (current user)
          p2Points,
          importTreasureHash,
          signer
        );

        // Step 2: Player 2 finalizes and submits (they are the transaction source)
        console.log('Simulating and submitting transaction...');
        await aetherGridService.finalizeStartGame(
          fullySignedTxXDR,
          userAddress,
          signer
        );

        // If we get here, transaction succeeded! Now update state.
        console.log('Transaction submitted successfully! Updating state...');
        setSessionId(gameParams.sessionId);
        setSuccess('Game created successfully! Both players signed.');
        setGamePhase('guess');

        // Clear import fields
        setImportAuthEntryXDR('');
        setImportSessionId('');
        setImportPlayer1('');
        setImportPlayer1Points('');
        setImportPlayer2Points(DEFAULT_POINTS);

        // Load the newly created game state
        await loadGameState();

        // Refresh dashboard to show updated available points (locked in game)
        onStandingsRefresh();

        // Clear success message after 2 seconds
        setTimeout(() => setSuccess(null), 2000);
      } catch (err) {
        console.error('Import transaction error:', err);
        // Extract detailed error message if available
        let errorMessage = 'Failed to import and sign transaction';
        if (err instanceof Error) {
          errorMessage = err.message;

          // Check for common Soroban errors
          if (err.message.includes('simulation failed')) {
            errorMessage = `Simulation failed: ${err.message}. Check that you have enough Points and the game parameters are correct.`;
          } else if (err.message.includes('transaction failed')) {
            errorMessage = `Transaction failed: ${err.message}. The game could not be created on the blockchain.`;
          }
        }

        setError(errorMessage);

        // Keep the component in 'create' phase so user can see the error and retry
        // Don't change gamePhase or clear any fields - let the user see what went wrong
      } finally {
        setLoading(false);
      }
    });
  };

  const handleLoadExistingGame = async () => {
    await runAction(async () => {
      try {
        setLoading(true);
        setError(null);
        setSuccess(null);
        const parsedSessionId = parseInt(loadSessionId.trim());
        if (isNaN(parsedSessionId) || parsedSessionId <= 0) {
          throw new Error('Enter a valid session ID');
        }

        // Try to load the game (use cache to prevent duplicate calls)
        const game = await requestCache.dedupe(
          createCacheKey('game-state', parsedSessionId),
          () => aetherGridService.getGame(parsedSessionId),
          5000
        );

        // Verify game exists and user is one of the players
        if (!game) {
          throw new Error('Game not found');
        }

        if (game.player1 !== userAddress && game.player2 !== userAddress) {
          throw new Error('You are not a player in this game');
        }

        // Load successful - update session ID and transition to game
        setSessionId(parsedSessionId);
        setGameState(game);
        setLoadSessionId('');

        // Restore treasure private inputs deterministically from the session ID.
        // These are needed if the prove phase is entered after board completion.
        {
          const loadedTile = getHiddenObjectTileForSession(parsedSessionId);
          const loadedX = Math.floor(loadedTile.x);
          const loadedY = Math.floor(loadedTile.y);
          const loadedNullifier = parsedSessionId >>> 0;
          setTreasureX(loadedX);
          setTreasureY(loadedY);
          setTreasureNullifier(loadedNullifier);
          // Compute & store the hash so the ZkProofSection sees the correct public input.
          BarretenbergSync.initSingleton().then((api) => {
            const hFr = api.poseidon2Hash([new Fr(BigInt(loadedX)), new Fr(BigInt(loadedY)), new Fr(BigInt(loadedNullifier))]);
            setTreasureHashHex(hFr.toString().replace(/^0x/, '').padStart(64, '0'));
          }).catch(console.error);
        }

        // Determine game phase based on ZK contract state
        if (game.resolved) {
          setGamePhase('complete');
          setSuccess('Game loaded! Already resolved.');
        } else if (game.player1_energy !== null || game.player2_energy !== null) {
          // At least one proof submitted
          setGamePhase('resolve');
          setSuccess('Game loaded! Ready to resolve.');
        } else {
          // Still in guessing/board phase
          setGamePhase('guess');
          setSuccess('Game loaded! Navigate the board.');
        }

        // Clear success message after 2 seconds
        setTimeout(() => setSuccess(null), 2000);
      } catch (err) {
        console.error('Load game error:', err);
        setError(err instanceof Error ? err.message : 'Failed to load game');
      } finally {
        setLoading(false);
      }
    });
  };

  const copyAuthEntryToClipboard = async () => {
    if (exportedAuthEntryXDR) {
      try {
        await navigator.clipboard.writeText(exportedAuthEntryXDR);
        setAuthEntryCopied(true);
        setTimeout(() => setAuthEntryCopied(false), 2000);
      } catch (err) {
        console.error('Failed to copy auth entry XDR:', err);
        setError('Failed to copy to clipboard');
      }
    }
  };

  const copyShareGameUrlWithAuthEntry = async () => {
    if (exportedAuthEntryXDR) {
      try {
        // Build URL with only Player 1's info and auth entry
        // Player 2 will specify their own points when they import
        const params = new URLSearchParams({
          'game': 'aether-grid',
          'auth': exportedAuthEntryXDR,
        });

        const shareUrl = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
        await navigator.clipboard.writeText(shareUrl);
        setShareUrlCopied(true);
        setTimeout(() => setShareUrlCopied(false), 2000);
      } catch (err) {
        console.error('Failed to copy share URL:', err);
        setError('Failed to copy to clipboard');
      }
    }
  };

  const copyShareGameUrlWithSessionId = async () => {
    if (loadSessionId) {
      try {
        const shareUrl = `${window.location.origin}${window.location.pathname}?game=aether-grid&session-id=${loadSessionId}`;
        await navigator.clipboard.writeText(shareUrl);
        setShareUrlCopied(true);
        setTimeout(() => setShareUrlCopied(false), 2000);
      } catch (err) {
        console.error('Failed to copy share URL:', err);
        setError('Failed to copy to clipboard');
      }
    }
  };

  /** When the board finishes (treasure found): store the energy and transition to ZK proof phase. */
  const handleBoardFinish = async (energy: number) => {
    // Guard: ensure this is the right player's board.
    const store = useAetherGameStore.getState();
    const currentPlayerNum = gameState?.player1 === userAddress ? 1 : gameState?.player2 === userAddress ? 2 : null;
    if (currentPlayerNum == null || store.matchPlayerNumber !== currentPlayerNum) {
      setError('This board does not match your player. Refresh or switch wallet.');
      return;
    }

    // ── LOG: Board finished ────────────────────────────────────────────────
    zkLog.section('AetherGridGame · handleBoardFinish', {
      energyUsedOnBoard: energy,
      playerNumber:      currentPlayerNum,
      sessionId,
      treasureX,
      treasureY,
      treasureNullifier,
      treasureHashHex,
    });
    zkLog.end();
    // ───────────────────────────────────────────────────────────────────

    setError(null);
    setBoardEnergyForProof(energy);
    setGamePhase('prove');
  };

  /** Submit a generated ZK proof to the contract. */
  const handleSubmitProof = async (proof: ZkProofResult) => {
    await runAction(async () => {
      try {
        setLoading(true);
        setError(null);
        setSuccess(null);

        // ── LOG: Proof received from ZkProofSection ────────────────────────
        zkLog.section('AetherGridGame · handleSubmitProof — pre-flight check', {
          sessionId,
          userAddress,
          boardEnergyForProof,
          proofByteLength:        proof.proofBytes.length,
          publicInputsByteLength: proof.publicInputsBuffer.length,
          localTreasureHashHex:   treasureHashHex,
          treasureX,
          treasureY,
          treasureNullifier,
        });
        zkLog.hex('AetherGridGame·handleSubmitProof', 'publicInputsBuffer being sent', proof.publicInputsBuffer);
        zkLog.end();
        // ───────────────────────────────────────────────────────────────────

        // Check if already submitted
        requestCache.invalidate(createCacheKey('game-state', sessionId));
        const fresh = await aetherGridService.getGame(sessionId);
        const alreadySubmitted =
          fresh &&
          ((fresh.player1 === userAddress && fresh.player1_energy != null) ||
            (fresh.player2 === userAddress && fresh.player2_energy != null));
        if (alreadySubmitted) {
          zkLog.warn('AetherGridGame·handleSubmitProof', 'Already submitted — skipping re-submission');
          await loadGameState();
          setLoading(false);
          return;
        }

        const signer = getContractSigner();
        await aetherGridService.submitZkProof(
          sessionId,
          userAddress,
          proof.proofBytes,
          proof.publicInputsBuffer,
          boardEnergyForProof,
          signer
        );

        zkLog.success('AetherGridGame·handleSubmitProof', 'ZK proof submitted on-chain! Transitioning to resolve phase.');
        setProofSubmitted(true);
        requestCache.invalidate(createCacheKey('game-state', sessionId));
        await loadGameState();
        setGamePhase('resolve');
        setSuccess('ZK proof submitted! Waiting for the other player or resolve the game.');
        setTimeout(() => setSuccess(null), 4000);
      } catch (err) {
        console.error('ZK proof submission error:', err);
        zkLog.error('AetherGridGame·handleSubmitProof', 'Submission error', err);
        const msg = err instanceof Error ? err.message : String(err);
        const isAlready = msg.includes('AlreadySubmitted') || msg.includes('Contract, #3');
        setError(
          isAlready
            ? 'You already submitted a proof for this session.'
            : msg || 'Error submitting ZK proof'
        );
      } finally {
        setLoading(false);
      }
    });
  };

  /** Resolve the game on-chain after at least one proof has been submitted. */
  const handleResolveGame = async () => {
    await runAction(async () => {
      try {
        setLoading(true);
        setError(null);
        setSuccess(null);

        const signer = getContractSigner();
        const resolvedOutcome = await aetherGridService.resolveGame(sessionId, userAddress, signer);
        setOutcome(resolvedOutcome);

        // Reload state
        requestCache.invalidate(createCacheKey('game-state', sessionId));
        const updatedGame = await aetherGridService.getGame(sessionId);
        setGameState(updatedGame);
        setGamePhase('complete');

        const pn = gameState?.player1 === userAddress ? 1 : 2;
        clearSessionStorage(sessionId, pn);

        const outcomeTag = resolvedOutcome?.tag;
        const isWinner =
          (outcomeTag === 'Player1Won' && gameState?.player1 === userAddress) ||
          (outcomeTag === 'Player2Won' && gameState?.player2 === userAddress) ||
          outcomeTag === 'BothFoundTreasure';
        setSuccess(isWinner ? '🎉 You won!' : 'Game complete! Winner determined.');
        onStandingsRefresh();
      } catch (err) {
        console.error('Resolve game error:', err);
        const msg = err instanceof Error ? err.message : String(err);
        const isNobody = msg.includes('NeitherPlayerSubmitted') || msg.includes('Contract, #4');
        setError(
          isNobody
            ? 'No player has submitted a valid ZK proof yet. At least one player must prove first.'
            : msg || 'Error resolving game'
        );
      } finally {
        setLoading(false);
      }
    });
  };

  const isPlayer1 = gameState && gameState.player1 === userAddress;
  const isPlayer2 = gameState && gameState.player2 === userAddress;
  // Player has "submitted" once their energy is recorded on-chain
  const hasSubmitted = isPlayer1 ? (gameState?.player1_energy != null) :
    isPlayer2 ? (gameState?.player2_energy != null) : false;

  const setGameRole = useGameRoleStore((s) => s.setGameRole);
  const setSendStatusText = useGameRoleStore((s) => s.setSendStatusText);
  useEffect(() => {
    if (gamePhase === 'guess' && gameState) {
      setGameRole(isPlayer1 ? 1 : isPlayer2 ? 2 : null);
      const sendText =
        gameState.player1_energy != null && gameState.player2_energy != null
          ? 'Both submitted proofs.'
          : gameState.player1_energy != null
            ? `Player 1 submitted proof. Waiting for Player 2...`
            : gameState.player2_energy != null
              ? `Player 2 submitted proof. Waiting for Player 1...`
              : 'Waiting for submissions.';
      setSendStatusText(sendText);
    } else {
      setGameRole(null);
      setSendStatusText(null);
    }
  }, [gamePhase, gameState, isPlayer1, isPlayer2, setGameRole, setSendStatusText]);

  const player1Energy = gameState?.player1_energy;
  const player2Energy = gameState?.player2_energy;

  const showPlayer1Card = isPlayer1 && !hasSubmitted;
  const showPlayer2Card = isPlayer2 && !hasSubmitted;

  // Layout tipo combate: mapa a pantalla completa, fondo background.png visible, título centrado, UI estilo máquina izquierda/derecha
  if (gamePhase === 'guess' && gameState) {
    return (
      <div className="aether-grid-combat">
        <div className="aether-grid-combat__map">
          <AetherGame onFinish={handleBoardFinish} skipNextFinishRef={skipNextFinishRef} />
        </div>
        {/* <h2 className="aether-grid-combat__title" aria-live="polite">
          <span className="aether-grid-combat__title-text">
            Encuentra el objeto en el tablero. Gana quien menos energía gaste.
          </span>
        </h2> */}
        <div className="aether-grid-combat__ui aether-grid-combat__ui--left" aria-label="Player 1">
          <div className="aether-grid-combat-card aether-grid-combat-card--player1">
            <div className="aether-grid-combat-card__header">PLAYER 1</div>
            {/* <div className="aether-grid-combat-card__section">
              <div className="aether-grid-combat-card__label">Session</div>
              <div className="aether-grid-combat-card__value aether-grid-combat-card__value--cyan">{sessionId}</div>
            </div> */}
            {error && (
              <div className="aether-grid-combat-card__section">
                <p className="aether-grid-combat-msg aether-grid-combat-msg--error">{error}</p>
              </div>
            )}
            <div className="aether-grid-combat-card__section">
              <div className="aether-grid-combat-card__label">Wallet</div>
              <div className="aether-grid-combat-card__value">{gameState.player1.slice(0, 8)}...{gameState.player1.slice(-4)}</div>
            </div>

            {/* <div className="aether-grid-combat-card__section">
              <div className="aether-grid-combat-card__label">Points</div>
              <div className="aether-grid-combat-card__value">{(Number(gameState.player1_points) / 10000000).toFixed(2)}</div>
            </div> */}
            <div className="aether-grid-combat-card__section">
              <div className="aether-grid-combat-card__label">Status</div>
              {gameState.player1_energy != null ? (
                <span className="aether-grid-combat-card__badge aether-grid-combat-card__badge--sent">✓ Proof Submitted</span>
              ) : (
                <span className="aether-grid-combat-card__badge aether-grid-combat-card__badge--waiting">Waiting...</span>
              )}
            </div>
            {showPlayer1Card && (
              <div className="aether-grid-combat-card__section">
                {boardPhase === 'FINISHED' && (
                  <button
                    type="button"
                    onClick={() => handleBoardFinish(boardEnergy)}
                    disabled={loading}
                    className="aether-grid-combat-btn"
                  >
                    {loading ? 'Sending...' : 'Send energy'}
                  </button>
                )}
                {loading && boardPhase !== 'FINISHED' && (
                  <p className="aether-grid-combat-msg">Sending energy...</p>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="aether-grid-combat__ui aether-grid-combat__ui--right" aria-label="Player 2 and status">
          <div className="aether-grid-combat-card aether-grid-combat-card--player2">
            <div className="aether-grid-combat-card__header">PLAYER 2</div>
            <div className="aether-grid-combat-card__section">
              <div className="aether-grid-combat-card__label">Wallet</div>
              <div className="aether-grid-combat-card__value">{gameState.player2.slice(0, 8)}...{gameState.player2.slice(-4)}</div>
            </div>
            {/* <div className="aether-grid-combat-card__section">
              <div className="aether-grid-combat-card__label">Points</div>
              <div className="aether-grid-combat-card__value">{(Number(gameState.player2_points) / 10000000).toFixed(2)}</div>
            </div> */}
            <div className="aether-grid-combat-card__section">
              <div className="aether-grid-combat-card__label">Status</div>
              {gameState.player2_energy != null ? (
                <span className="aether-grid-combat-card__badge aether-grid-combat-card__badge--sent">✓ Proof Submitted</span>
              ) : (
                <span className="aether-grid-combat-card__badge aether-grid-combat-card__badge--waiting">Waiting...</span>
              )}
            </div>
            {showPlayer2Card && (
              <div className="aether-grid-combat-card__section">
                {boardPhase === 'FINISHED' && (
                  <button
                    type="button"
                    onClick={() => handleBoardFinish(boardEnergy)}
                    disabled={loading}
                    className="aether-grid-combat-btn"
                  >
                    {loading ? 'Processing...' : '🔐 Generate ZK Proof'}
                  </button>
                )}
                {loading && boardPhase !== 'FINISHED' && (
                  <p className="aether-grid-combat-msg">Sending energy...</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="aether-create-shell">
      {error && (
        <div className="aether-create-message aether-create-message--error">
          <p>{error}</p>
        </div>
      )}

      {success && (
        <div className="aether-create-message aether-create-message--success">
          <p>{success}</p>
        </div>
      )}

      {/* CREATE GAME PHASE */}
      {gamePhase === 'create' && (
        <div className="space-y-6">
          {/* Mode Toggle */}
          <div className="aether-create-tabs">
            <button
              onClick={() => {
                setCreateMode('create');
                setExportedAuthEntryXDR(null);
                setImportAuthEntryXDR('');
                setImportSessionId('');
                setImportPlayer1('');
                setImportPlayer1Points('');
                setImportPlayer2Points(DEFAULT_POINTS);
                setLoadSessionId('');
              }}
              className={`aether-create-tab ${createMode === 'create' ? 'aether-create-tab--active' : ''}`}
            >
              Create & Export
            </button>
            <button
              onClick={() => {
                setCreateMode('import');
                setExportedAuthEntryXDR(null);
                setLoadSessionId('');
              }}
              className={`aether-create-tab ${createMode === 'import' ? 'aether-create-tab--active' : ''}`}
            >
              Import Auth Entry
            </button>
            <button
              onClick={() => {
                setCreateMode('load');
                setExportedAuthEntryXDR(null);
                setImportAuthEntryXDR('');
                setImportSessionId('');
                setImportPlayer1('');
                setImportPlayer1Points('');
                setImportPlayer2Points(DEFAULT_POINTS);
              }}
              className={`aether-create-tab ${createMode === 'load' ? 'aether-create-tab--active' : ''}`}
            >
              Load Existing Game
            </button>
          </div>

          <div className="aether-create-quickstart">
            <div className="aether-create-quickstart__content">
              <p className="aether-create-quickstart__title">⚡ Quickstart (Dev)</p>
              <p className="aether-create-quickstart__desc">
                Creates and signs for both dev wallets in one click. Works only in the Games Library.
              </p>
            </div>
            <button
              onClick={handleQuickStart}
              disabled={isBusy || !quickstartAvailable}
              className="aether-create-quickstart__btn"
            >
              {quickstartLoading ? 'Quickstarting...' : '⚡ Quickstart Game'}
            </button>
          </div>

          {createMode === 'create' ? (
            <div className="aether-create-form">
              <div className="aether-create-form__fields">
                <div className="aether-create-field">
                  <label className="aether-create-label">Your Address (Player 1)</label>
                  <input
                    type="text"
                    value={player1Address}
                    onChange={(e) => setPlayer1Address(e.target.value.trim())}
                    placeholder="G..."
                    className="aether-create-input"
                  />
                  <p className="aether-create-hint">
                    Pre-filled from your connected wallet. If you change it, you must be able to sign as that address.
                  </p>
                </div>

                <div className="aether-create-field">
                  <label className="aether-create-label">Your Points</label>
                  <input
                    type="text"
                    value={player1Points}
                    onChange={(e) => setPlayer1Points(e.target.value)}
                    placeholder="0.1"
                    className="aether-create-input"
                  />
                  <p className="aether-create-hint">
                    Available: {(Number(availablePoints) / 10000000).toFixed(2)} Points
                  </p>
                </div>

                <div className="aether-create-info">
                  <p>ℹ️ Player 2 will specify their own address and points when they import your auth entry. You only need to prepare and export your signature.</p>
                </div>
              </div>

              <div className="aether-create-form__actions">
                <p className="aether-create-session">Session ID: {sessionId}</p>

                {!exportedAuthEntryXDR ? (
                  <button
                    onClick={handlePrepareTransaction}
                    disabled={isBusy}
                    className="aether-create-btn aether-create-btn--primary"
                  >
                    {loading ? 'Preparing...' : 'Prepare & Export Auth Entry'}
                  </button>
                ) : (
                  <div className="aether-create-export">
                    <div className="aether-create-export__box">
                      <p className="aether-create-export__title">Auth Entry XDR (Player 1 Signed)</p>
                      <div className="aether-create-export__code">
                        <code>{exportedAuthEntryXDR}</code>
                      </div>
                      <div className="aether-create-export__btns">
                        <button
                          onClick={copyAuthEntryToClipboard}
                          className="aether-create-btn aether-create-btn--secondary"
                        >
                          {authEntryCopied ? '✓ Copied!' : '📋 Copy Auth Entry'}
                        </button>
                        <button
                          onClick={copyShareGameUrlWithAuthEntry}
                          className="aether-create-btn aether-create-btn--secondary"
                        >
                          {shareUrlCopied ? '✓ Copied!' : '🔗 Share URL'}
                        </button>
                      </div>
                    </div>
                    <p className="aether-create-export__hint">
                      Copy the auth entry XDR or share URL with Player 2 to complete the transaction
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : createMode === 'import' ? (
            /* IMPORT MODE */
            <div className="aether-create-form">
              <div className="aether-create-export__box">
                <p className="aether-create-export__title">📥 Import Auth Entry from Player 1</p>
                <p className="aether-create-hint" style={{ marginBottom: '1rem' }}>
                  Paste the auth entry XDR from Player 1. Session ID, Player 1 address, and their points will be auto-extracted. You only need to enter your points amount.
                </p>
                <div className="aether-create-form__fields">
                  <div>
                    <label className="aether-create-label">
                      Auth Entry XDR
                      {xdrParsing && <span className="aether-create-hint" style={{ marginLeft: '0.5rem' }}>Parsing...</span>}
                      {xdrParseSuccess && <span style={{ marginLeft: '0.5rem', color: '#67e8f9', fontSize: '0.7rem' }}>✓ Parsed</span>}
                      {xdrParseError && <span style={{ marginLeft: '0.5rem', color: '#fca5a5', fontSize: '0.7rem' }}>✗ Parse failed</span>}
                    </label>
                    <textarea
                      value={importAuthEntryXDR}
                      onChange={(e) => setImportAuthEntryXDR(e.target.value)}
                      placeholder="Paste Player 1's signed auth entry XDR here..."
                      rows={4}
                      className={`aether-create-input ${xdrParseError ? 'aether-create-input--error' : ''}`}
                      style={{ resize: 'none', minHeight: '100px' }}
                    />
                    {xdrParseError && (
                      <p className="text-xs text-red-600 font-semibold mt-1">
                        {xdrParseError}
                      </p>
                    )}
                  </div>
                  {/* Auto-populated fields from auth entry (read-only) */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="aether-create-field">
                      <label className="aether-create-label">Session ID (auto-filled)</label>
                      <input type="text" value={importSessionId} readOnly placeholder="Auto-filled from auth entry" className="aether-create-input aether-create-input--readonly" />
                    </div>
                    <div className="aether-create-field">
                      <label className="aether-create-label">Player 1 Points (auto-filled)</label>
                      <input type="text" value={importPlayer1Points} readOnly placeholder="Auto-filled from auth entry" className="aether-create-input aether-create-input--readonly" />
                    </div>
                  </div>
                  <div className="aether-create-field">
                    <label className="aether-create-label">Player 1 Address (auto-filled)</label>
                    <input type="text" value={importPlayer1} readOnly placeholder="Auto-filled from auth entry" className="aether-create-input aether-create-input--readonly" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="aether-create-field">
                      <label className="aether-create-label">Player 2 (You)</label>
                      <input type="text" value={userAddress} readOnly className="aether-create-input aether-create-input--readonly" />
                    </div>
                    <div className="aether-create-field">
                      <label className="aether-create-label">Your Points *</label>
                      <input
                        type="text"
                        value={importPlayer2Points}
                        onChange={(e) => setImportPlayer2Points(e.target.value)}
                        placeholder="e.g., 0.1"
                        className="aether-create-input"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <button
                onClick={handleImportTransaction}
                disabled={isBusy || !importAuthEntryXDR.trim() || !importPlayer2Points.trim()}
                className="aether-create-btn aether-create-btn--primary"
              >
                {loading ? 'Importing & Signing...' : 'Import & Sign Auth Entry'}
              </button>
            </div>
          ) : createMode === 'load' ? (
            /* LOAD EXISTING GAME MODE */
            <div className="aether-create-form">
              <div className="aether-create-export__box">
                <p className="aether-create-export__title">🎮 Load Existing Game by Session ID</p>
                <p className="aether-create-hint" style={{ marginBottom: '0.75rem' }}>Enter a session ID to load and continue an existing game. You must be one of the players.</p>
                <input
                  type="text"
                  value={loadSessionId}
                  onChange={(e) => setLoadSessionId(e.target.value)}
                  placeholder="Enter session ID (e.g., 123456789)"
                  className="aether-create-input"
                />
              </div>

              <div className="aether-create-info">
                <p className="aether-create-export__title" style={{ marginBottom: '0.5rem' }}>Requirements</p>
                <ul className="aether-create-hint" style={{ margin: 0, paddingLeft: '1.25rem' }}>
                  <li>You must be Player 1 or Player 2 in the game</li>
                  <li>Game must be active (not completed)</li>
                  <li>Valid session ID from an existing game</li>
                </ul>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  onClick={handleLoadExistingGame}
                  disabled={isBusy || !loadSessionId.trim()}
                  className="aether-create-btn aether-create-btn--primary"
                >
                  {loading ? 'Loading...' : '🎮 Load Game'}
                </button>
                <button
                  onClick={copyShareGameUrlWithSessionId}
                  disabled={!loadSessionId.trim()}
                  className="aether-create-btn aether-create-btn--secondary"
                >
                  {shareUrlCopied ? '✓ Copied!' : '🔗 Share Game'}
                </button>
              </div>
              <p className="aether-create-export__hint">Load the game to continue playing, or share the URL with another player</p>
            </div>
          ) : null}
        </div>
      )}

      {/* PROVE PHASE — ZK proof generation */}
      {gamePhase === 'prove' && gameState && (
        <div className="aether-create-form">
          <div className="aether-reveal-box">
            <div className="aether-reveal-box__icon">🔐</div>
            <h3 className="aether-reveal-box__title">Board Complete — Generate ZK Proof</h3>
            <p className="aether-reveal-box__desc">
              You finished the board with <strong>{boardEnergyForProof} energy</strong>.
              Now prove you know the treasure coordinates without revealing them on-chain.
            </p>
          </div>
          {error && (
            <div className="aether-create-message aether-create-message--error">
              <p>{error}</p>
            </div>
          )}
          {success && (
            <div className="aether-create-message aether-create-message--success">
              <p>{success}</p>
            </div>
          )}
          <ZkProofSection
            treasureHash={treasureHashHex}
            boardEnergy={boardEnergyForProof}
            x={treasureX}
            y={treasureY}
            nullifier={treasureNullifier}
            autoStart={true}
            onProofReady={(result) => {
              setPendingProof(result);
              setProofReady(true);
              // Auto-submit: no user action required
              handleSubmitProof(result);
            }}
            disabled={loading}
          />
          {loading && (
            <p className="text-xs text-center text-indigo-600 font-semibold mt-3 animate-pulse">
              ⏳ Submitting proof on-chain…
            </p>
          )}
        </div>
      )}

      {/* RESOLVE PHASE — at least one proof submitted, can resolve */}
      {gamePhase === 'resolve' && gameState && (
        <div className="aether-create-form">
          <div className="aether-reveal-box">
            <div className="aether-reveal-box__icon">⚖️</div>
            <h3 className="aether-reveal-box__title">Ready to Resolve!</h3>
            <p className="aether-reveal-box__desc">
              {gameState.player1_energy != null && gameState.player2_energy != null
                ? 'Both players submitted proofs. Resolve to determine the winner!'
                : 'At least one player submitted a proof. Resolve whenever ready.'}
            </p>
            {!proofSubmitted && (
              <p className="text-xs text-amber-600 font-semibold mt-2">
                ⚠️ You haven't submitted your proof yet. You can still submit or let the opponent win.
              </p>
            )}
          </div>
          {error && (
            <div className="aether-create-message aether-create-message--error">
              <p>{error}</p>
            </div>
          )}
          {success && (
            <div className="aether-create-message aether-create-message--success">
              <p>{success}</p>
            </div>
          )}
          <button
            onClick={handleResolveGame}
            disabled={isBusy}
            className="aether-create-btn aether-create-btn--primary"
          >
            {loading ? 'Resolving…' : '⚖️ Resolve Game'}
          </button>
        </div>
      )}

      {/* COMPLETE PHASE */}
      {gamePhase === 'complete' && gameState && (
        <div className="aether-create-form aether-create-form--complete">
          <div className="aether-complete">
            <div className="aether-complete-header">
              <div className="aether-complete-trophy">🏆</div>
              <h3 className="aether-complete-title">Game complete!</h3>
              <p className="aether-complete-desc">
                {outcome ? (
                  outcome.tag === 'Player1Won' ? 'Player 1 used less energy and wins!' :
                  outcome.tag === 'Player2Won' ? 'Player 2 used less energy and wins!' :
                  outcome.tag === 'BothFoundTreasure' ? 'Tie in energy! Player 1 wins tiebreaker.' :
                  'Neither player submitted a valid proof.'
                ) : 'Game resolved.'}
              </p>
            </div>
            <div className="aether-complete-players">
              {[
                { key: 1, address: gameState.player1, energy: player1Energy, label: 'Player 1' },
                { key: 2, address: gameState.player2, energy: player2Energy, label: 'Player 2' },
              ].map(({ key, address, energy, label }) => {
                const isWinner =
                  (outcome?.tag === 'Player1Won' && address === gameState.player1) ||
                  (outcome?.tag === 'Player2Won' && address === gameState.player2) ||
                  (outcome?.tag === 'BothFoundTreasure' && address === gameState.player1);
                const isYou = address === userAddress;
                return (
                  <div
                    key={key}
                    className={`aether-complete-player ${isWinner ? 'aether-complete-player--winner' : ''}`}
                  >
                    <div className="aether-complete-player-top">
                      <span className="aether-complete-player-label">{label}</span>
                      {isWinner && <span className="aether-complete-player-winner-tag">Winner</span>}
                    </div>
                    <div className="aether-complete-player-address">{address.slice(0, 8)}…{address.slice(-4)}</div>
                    <div className="aether-complete-player-stats">
                      <span>Energy: {energy ?? '—'}</span>
                    </div>
                    {isWinner && isYou && <p className="aether-complete-player-celebration">🎉 You won!</p>}
                  </div>
                );
              })}
            </div>
            <button onClick={handleStartNewGame} className="aether-create-btn aether-create-btn--secondary aether-complete-new-btn">
              New game
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
