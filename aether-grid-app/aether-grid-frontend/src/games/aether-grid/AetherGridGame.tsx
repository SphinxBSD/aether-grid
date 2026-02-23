import { useState, useEffect, useRef } from 'react';
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
} from '@/components/aether-board/game/gameStore';
import { useGameRoleStore } from '@/stores/gameRoleStore';
import type { Game } from './bindings';

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
  const [guess, setGuess] = useState<number | null>(null);
  const [gameState, setGameState] = useState<Game | null>(null);
  const [loading, setLoading] = useState(false);
  const [quickstartLoading, setQuickstartLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [lastSubmittedEnergy, setLastSubmittedEnergy] = useState<number | null>(null);
  const [gamePhase, setGamePhase] = useState<'create' | 'guess' | 'reveal' | 'complete'>('create');
  const [createMode, setCreateMode] = useState<'create' | 'import' | 'load'>('create');
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
    if (gameState?.winner) {
      onGameComplete();
    }

    actionLock.current = false;
    setGamePhase('create');
    setSessionId(createRandomSessionId());
    setGameState(null);
    setGuess(null);
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

      // Determine game phase based on state
      if (game && game.winner !== null && game.winner !== undefined) {
        setGamePhase('complete');
      } else if (game && game.player1_guess !== null && game.player1_guess !== undefined &&
                 game.player2_guess !== null && game.player2_guess !== undefined) {
        setGamePhase('reveal');
      } else {
        setGamePhase('guess');
      }

      // No mostrar mensaje de éxito del otro jugador: si este usuario aún no ha enviado on-chain, limpiar success/loading
      if (game && userAddress) {
        const thisUserGuessed =
          (game.player1 === userAddress && game.player1_guess != null) ||
          (game.player2 === userAddress && game.player2_guess != null);
        if (!thisUserGuessed) {
          setSuccess(null);
          setLoading(false);
        }
      }
    } catch (err) {
      // Game doesn't exist yet
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

  // Auto-refresh standings when game completes (for passive player who didn't call reveal_winner)
  useEffect(() => {
    if (gamePhase === 'complete' && gameState?.winner) {
      console.log('Game completed! Refreshing standings and dashboard data...');
      onStandingsRefresh(); // Refresh standings and available points; don't call onGameComplete() here or it will close the game!
    }
  }, [gamePhase, gameState?.winner]);

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

        console.log('Preparing transaction for Player 1 to sign...');
        console.log('Using placeholder Player 2 values for simulation only');
        const authEntryXDR = await aetherGridService.prepareStartGame(
          sessionId,
          player1Address,
          placeholderPlayer2Address,
          p1Points,
          placeholderP2Points,
          signer
        );

        console.log('Transaction prepared successfully! Player 1 has signed their auth entry.');
        setExportedAuthEntryXDR(authEntryXDR);
        setSuccess('Firma lista. Copia el XDR o la URL y envíala al Jugador 2. Esperando a que el otro jugador empiece...');

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

        const authEntryXDR = await aetherGridService.prepareStartGame(
          quickstartSessionId,
          player1AddressQuickstart,
          placeholderPlayer2Address,
          p1Points,
          p1Points,
          player1Signer
        );

        const fullySignedTxXDR = await aetherGridService.importAndSignAuthEntry(
          authEntryXDR,
          player2AddressQuickstart,
          p1Points,
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

        // Step 1: Import Player 1's signed auth entry and rebuild transaction
        // New simplified API - only needs: auth entry, player 2 address, player 2 points
        console.log('Importing Player 1 auth entry and rebuilding transaction...');
        const fullySignedTxXDR = await aetherGridService.importAndSignAuthEntry(
          importAuthEntryXDR.trim(),
          userAddress, // Player 2 address (current user)
          p2Points,
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

        // Determine game phase based on game state
        if (game.winner !== null && game.winner !== undefined) {
          // Game is complete - show reveal phase with winner
          setGamePhase('reveal');
          const isWinner = game.winner === userAddress;
          setSuccess(isWinner ? '🎉 You won this game!' : 'Game complete. Winner revealed.');
        } else if (game.player1_guess !== null && game.player1_guess !== undefined &&
            game.player2_guess !== null && game.player2_guess !== undefined) {
          // Both players guessed, waiting for reveal
          setGamePhase('reveal');
          setSuccess('Game loaded! Both players have guessed. You can reveal the winner.');
        } else {
          // Still in guessing phase
          setGamePhase('guess');
          setSuccess('Game loaded! Make your guess.');
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

  const handleMakeGuess = async () => {
    if (guess === null) {
      setError('Select a number to guess');
      return;
    }

    await runAction(async () => {
      try {
        setLoading(true);
        setError(null);
        setSuccess(null);

        const signer = getContractSigner();
        await aetherGridService.makeGuess(sessionId, userAddress, guess, signer);

        setSuccess(`Guess submitted: ${guess}`);
        await loadGameState();
      } catch (err) {
        console.error('Make guess error:', err);
        setError(err instanceof Error ? err.message : 'Failed to make guess');
      } finally {
        setLoading(false);
      }
    });
  };

  /** Cuando el jugador termina en el tablero (encuentra el objeto), envía su energía al contrato (1-10). */
  const handleBoardFinish = async (energy: number) => {
    await runAction(async () => {
      try {
        setLoading(true);
        setError(null);
        setSuccess(null);

        // No enviar si el tablero no corresponde al usuario actual (evita enviar por el otro jugador).
        const store = useAetherGameStore.getState();
        const currentPlayerNum = gameState?.player1 === userAddress ? 1 : gameState?.player2 === userAddress ? 2 : null;
        if (currentPlayerNum == null || store.matchPlayerNumber !== currentPlayerNum) {
          setError('El tablero no corresponde a tu jugador. Refresca o cambia de wallet.');
          setLoading(false);
          return;
        }

        requestCache.invalidate(createCacheKey('game-state', sessionId));
        const fresh = await aetherGridService.getGame(sessionId);
        const alreadySubmitted =
          fresh &&
          ((fresh.player1 === userAddress && fresh.player1_guess != null) ||
            (fresh.player2 === userAddress && fresh.player2_guess != null));
        if (alreadySubmitted) {
          await loadGameState();
          setLoading(false);
          return;
        }

        // AUGUSTO ACA: enviar energía como valor 1-10 usando energía módulo 10 (0 → 10 para que sea válido)
        const guessValue = energy % 10 || 10;
        const signer = getContractSigner();
        await aetherGridService.makeGuess(sessionId, userAddress, guessValue, signer);
        requestCache.invalidate(createCacheKey('game-state', sessionId));
        setLastSubmittedEnergy(energy);
        await loadGameState();
      } catch (err) {
        console.error('Submit energy error:', err);
        const msg = err instanceof Error ? err.message : String(err);
        const isAlreadyGuessed = msg.includes('AlreadyGuessed') || msg.includes('Contract, #3');
        setError(
          isAlreadyGuessed
            ? 'Ya habías enviado tu energía. Si ves "Esperando...", refresca o espera a que el otro jugador termine.'
            : msg || 'Error al enviar energía'
        );
      } finally {
        setLoading(false);
      }
    });
  };

  const waitForWinner = async () => {
    let updatedGame = await aetherGridService.getGame(sessionId);
    let attempts = 0;
    while (attempts < 5 && (!updatedGame || updatedGame.winner === null || updatedGame.winner === undefined)) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      updatedGame = await aetherGridService.getGame(sessionId);
      attempts += 1;
    }
    return updatedGame;
  };

  const handleRevealWinner = async () => {
    await runAction(async () => {
      try {
        setLoading(true);
        setError(null);
        setSuccess(null);

        requestCache.invalidate(createCacheKey('game-state', sessionId));
        const freshGame = await aetherGridService.getGame(sessionId);
        const bothGuessed =
          freshGame &&
          freshGame.player1_guess !== null &&
          freshGame.player1_guess !== undefined &&
          freshGame.player2_guess !== null &&
          freshGame.player2_guess !== undefined;
        if (!bothGuessed) {
          setError(
            'Ambos jugadores deben enviar su energía primero. Asegúrate de que el otro jugador haya terminado y enviado.'
          );
          setLoading(false);
          return;
        }

        const signer = getContractSigner();
        await aetherGridService.revealWinner(sessionId, userAddress, signer);

        // Fetch updated on-chain state and derive the winner from it (avoid type mismatches from tx result decoding).
        const updatedGame = await waitForWinner();
        setGameState(updatedGame);
        setGamePhase('complete');
        const pn = freshGame!.player1 === userAddress ? 1 : 2;
        clearSessionStorage(sessionId, pn);

        const isWinner = updatedGame?.winner === userAddress;
        setSuccess(isWinner ? '🎉 You won!' : 'Game complete! Winner revealed.');

        // Refresh standings immediately (without navigating away)
        onStandingsRefresh();

        // DON'T call onGameComplete() immediately - let user see the results
        // User can click "Start New Game" when ready
      } catch (err) {
        console.error('Reveal winner error:', err);
        const msg = err instanceof Error ? err.message : String(err);
        const isBothNotGuessed =
          msg.includes('BothPlayersNotGuessed') || msg.includes('Contract, #4') || msg.includes('Error(Contract, #4)');
        if (isBothNotGuessed) {
          setError(
            'Ambos jugadores deben enviar su energía primero. Asegúrate de que el otro jugador haya terminado y enviado.'
          );
          setLoading(false);
          return;
        }

        const isTimeout =
          msg.includes('Waited ') && (msg.includes('did not') || msg.includes('Returning anyway'));
        const hashMatch = msg.match(/"hash"\s*:\s*"([a-f0-9]{64})"/i) ?? msg.match(/hash["\s:]+["']?([a-f0-9]{64})/i);
        const txHash = hashMatch?.[1];

        if (isTimeout || txHash) {
          setError(null);
          setSuccess('Transacción enviada. Comprobando estado del juego en la red…');
          const POLL_INTERVAL_MS = 2500;
          const POLL_MAX_MS = 90000;
          const start = Date.now();
          if (revealPollIntervalRef.current) clearInterval(revealPollIntervalRef.current);
          const pollId = setInterval(async () => {
            if (Date.now() - start > POLL_MAX_MS) {
              clearInterval(pollId);
              revealPollIntervalRef.current = null;
              setLoading(false);
              setSuccess(null);
              setError(
                txHash
                  ? `La confirmación tardó más de lo esperado. Comprueba el estado en el explorador (hash: ${txHash.slice(0, 8)}…). Puedes volver a pulsar "Revelar ganador" si la tx ya se aplicó.`
                  : 'La confirmación tardó más de lo esperado. Comprueba si el juego ya terminó o vuelve a intentar "Revelar ganador".'
              );
              return;
            }
            try {
              const game = await aetherGridService.getGame(sessionId);
              if (game?.winner != null && game?.winner !== undefined) {
                clearInterval(pollId);
                revealPollIntervalRef.current = null;
                setGameState(game);
                setGamePhase('complete');
                const pn = game.player1 === userAddress ? 1 : 2;
                clearSessionStorage(sessionId, pn);
                const isWinner = game.winner === userAddress;
                setSuccess(isWinner ? '🎉 ¡Ganaste!' : 'Juego completado. Ganador revelado.');
                setLoading(false);
                onStandingsRefresh();
              }
            } catch (_) {
              // sigue intentando
            }
          }, POLL_INTERVAL_MS);
          revealPollIntervalRef.current = pollId;
          setLoading(false);
          return;
        }

        setError(msg);
        setLoading(false);
      } finally {
        setLoading(false);
      }
    });
  };

  const isPlayer1 = gameState && gameState.player1 === userAddress;
  const isPlayer2 = gameState && gameState.player2 === userAddress;
  const hasGuessed = isPlayer1 ? gameState?.player1_guess !== null && gameState?.player1_guess !== undefined :
                     isPlayer2 ? gameState?.player2_guess !== null && gameState?.player2_guess !== undefined : false;

  const setGameRole = useGameRoleStore((s) => s.setGameRole);
  const setSendStatusText = useGameRoleStore((s) => s.setSendStatusText);
  useEffect(() => {
    if (gamePhase === 'guess' && gameState) {
      setGameRole(isPlayer1 ? 1 : isPlayer2 ? 2 : null);
      const sendText =
        gameState.player1_guess != null && gameState.player2_guess != null
          ? 'Ambos enviaron.'
          : gameState.player1_guess != null
            ? `Jugador 1 envió${isPlayer1 && lastSubmittedEnergy != null ? ` (${lastSubmittedEnergy})` : ''}. Esperando a Jugador 2...`
            : gameState.player2_guess != null
              ? `Jugador 2 envió${isPlayer2 && lastSubmittedEnergy != null ? ` (${lastSubmittedEnergy})` : ''}. Esperando a Jugador 1...`
              : 'Esperando envíos.';
      setSendStatusText(sendText);
    } else {
      setGameRole(null);
      setSendStatusText(null);
    }
  }, [gamePhase, gameState, isPlayer1, isPlayer2, lastSubmittedEnergy, setGameRole, setSendStatusText]);

  const winningNumber = gameState?.winning_number;
  const player1Guess = gameState?.player1_guess;
  const player2Guess = gameState?.player2_guess;
  const player1Distance =
    winningNumber !== null && winningNumber !== undefined && player1Guess !== null && player1Guess !== undefined
      ? Math.abs(Number(player1Guess) - Number(winningNumber))
      : null;
  const player2Distance =
    winningNumber !== null && winningNumber !== undefined && player2Guess !== null && player2Guess !== undefined
      ? Math.abs(Number(player2Guess) - Number(winningNumber))
      : null;

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
        <div className="aether-grid-combat__ui aether-grid-combat__ui--left" aria-label="Jugador 1">
          <div className="aether-grid-combat-card aether-grid-combat-card--player1">
            <div className="aether-grid-combat-card__header">JUGADOR 1</div>
            {/* <div className="aether-grid-combat-card__section">
              <div className="aether-grid-combat-card__label">Sesión</div>
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
            <div className="aether-grid-combat-card__section">
              <div className="aether-grid-combat-card__label">Puntos</div>
              <div className="aether-grid-combat-card__value">{(Number(gameState.player1_points) / 10000000).toFixed(2)}</div>
            </div>
            <div className="aether-grid-combat-card__section">
              <div className="aether-grid-combat-card__label">Estado</div>
              {gameState.player1_guess != null ? (
                <span className="aether-grid-combat-card__badge aether-grid-combat-card__badge--sent">✓ Enviado</span>
              ) : (
                <span className="aether-grid-combat-card__badge aether-grid-combat-card__badge--waiting">Esperando...</span>
              )}
            </div>
            {isPlayer1 && !hasGuessed && (
              <div className="aether-grid-combat-card__section">
                {boardPhase === 'FINISHED' && (
                  <button
                    type="button"
                    onClick={() => handleBoardFinish(boardEnergy)}
                    disabled={loading}
                    className="aether-grid-combat-btn"
                  >
                    {loading ? 'Enviando...' : 'Enviar energía'}
                  </button>
                )}
                {loading && boardPhase !== 'FINISHED' && (
                  <p className="aether-grid-combat-msg">Enviando energía...</p>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="aether-grid-combat__ui aether-grid-combat__ui--right" aria-label="Jugador 2 y estado">
          <div className="aether-grid-combat-card aether-grid-combat-card--player2">
            <div className="aether-grid-combat-card__header">JUGADOR 2</div>
            <div className="aether-grid-combat-card__section">
              <div className="aether-grid-combat-card__label">Wallet</div>
              <div className="aether-grid-combat-card__value">{gameState.player2.slice(0, 8)}...{gameState.player2.slice(-4)}</div>
            </div>
            <div className="aether-grid-combat-card__section">
              <div className="aether-grid-combat-card__label">Puntos</div>
              <div className="aether-grid-combat-card__value">{(Number(gameState.player2_points) / 10000000).toFixed(2)}</div>
            </div>
            <div className="aether-grid-combat-card__section">
              <div className="aether-grid-combat-card__label">Estado</div>
              {gameState.player2_guess != null ? (
                <span className="aether-grid-combat-card__badge aether-grid-combat-card__badge--sent">✓ Enviado</span>
              ) : (
                <span className="aether-grid-combat-card__badge aether-grid-combat-card__badge--waiting">Esperando...</span>
              )}
            </div>
            {isPlayer2 && !hasGuessed && (
              <div className="aether-grid-combat-card__section">
                {boardPhase === 'FINISHED' && (
                  <button
                    type="button"
                    onClick={() => handleBoardFinish(boardEnergy)}
                    disabled={loading}
                    className="aether-grid-combat-btn"
                  >
                    {loading ? 'Enviando...' : 'Enviar energía'}
                  </button>
                )}
                {loading && boardPhase !== 'FINISHED' && (
                  <p className="aether-grid-combat-msg">Enviando energía...</p>
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

      {/* REVEAL PHASE */}
      {gamePhase === 'reveal' && gameState && (
        <div className="aether-create-form">
          <div className="aether-reveal-box">
            <div className="aether-reveal-box__icon">🎊</div>
            <h3 className="aether-reveal-box__title">¡Ambos jugadores han terminado!</h3>
            <p className="aether-reveal-box__desc">Haz clic para revelar al ganador (quien menos energía gastó)</p>
            <button
              onClick={handleRevealWinner}
              disabled={isBusy}
              className="aether-create-btn aether-create-btn--primary"
            >
              {loading ? 'Revelando...' : 'Revelar ganador'}
            </button>
          </div>
        </div>
      )}

      {/* COMPLETE PHASE */}
      {gamePhase === 'complete' && gameState && (
        <div className="aether-create-form">
          <div className="aether-reveal-box">
            <div className="aether-reveal-box__icon">🏆</div>
            <h3 className="aether-reveal-box__title">¡Juego completado!</h3>
            <p className="aether-reveal-box__desc">Gana quien menos energía gastó</p>
            <div className="aether-create-export__box" style={{ textAlign: 'left', marginTop: '1rem', marginBottom: '1rem' }}>
              <p className="aether-create-export__title">Jugador 1</p>
              <p className="aether-create-hint">{gameState.player1.slice(0, 8)}...{gameState.player1.slice(-4)}</p>
              <p className="aether-create-label">Energía: {gameState.player1_guess ?? '—'}{player1Distance !== null ? ` (distancia ${player1Distance})` : ''}</p>
            </div>
            <div className="aether-create-export__box" style={{ textAlign: 'left', marginBottom: '1rem' }}>
              <p className="aether-create-export__title">Jugador 2</p>
              <p className="aether-create-hint">{gameState.player2.slice(0, 8)}...{gameState.player2.slice(-4)}</p>
              <p className="aether-create-label">Energía: {gameState.player2_guess ?? '—'}{player2Distance !== null ? ` (distancia ${player2Distance})` : ''}</p>
            </div>
            {gameState.winner && (
              <div className="aether-create-export__box" style={{ borderColor: 'rgba(0, 212, 255, 0.5)' }}>
                <p className="aether-create-export__title">Ganador</p>
                <p className="aether-create-label">{gameState.winner.slice(0, 8)}...{gameState.winner.slice(-4)}</p>
                {gameState.winner === userAddress && <p className="aether-create-message aether-create-message--success" style={{ marginTop: '0.5rem', marginBottom: 0 }}>🎉 ¡Ganaste!</p>}
              </div>
            )}
            <button onClick={handleStartNewGame} className="aether-create-btn aether-create-btn--secondary" style={{ marginTop: '1.25rem' }}>
              Nueva partida
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
