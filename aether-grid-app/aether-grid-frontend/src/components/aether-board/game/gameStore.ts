import { create } from 'zustand';
import { tileToWorld, manhattanPath, tileKey } from './gameUtils';

export type GamePhase = 'IDLE' | 'SPAWN_SELECT' | 'PLAYING' | 'MOVING';

const DRILL_FEEDBACK_MS = 600;

export interface TileCoord {
  x: number;
  y: number;
}

export interface WorldPos {
  x: number;
  y: number;
  z: number;
}

interface AetherGameState {
  phase: GamePhase;
  playerTile: TileCoord | null;
  /** Posición mundial actual del avatar (interpolada) */
  playerWorldPos: WorldPos;
  targetTile: TileCoord | null;
  /** Cola de tiles por los que caminar (Manhattan) */
  pathQueue: TileCoord[];
  /** Tiles con feedback de perforación (temporal) */
  drilledTiles: Set<string>;
  /** Tile bajo el mouse */
  hoveredTile: TileCoord | null;
  /** Si el avatar está en animación de perforar */
  isDrilling: boolean;
}

interface AetherGameActions {
  startGame: () => void;
  selectSpawn: (x: number, y: number) => void;
  setTargetAndMove: (x: number, y: number) => void;
  tickMovement: (deltaMs: number) => void;
  drillCurrentTile: () => void;
  setHoveredTile: (x: number | null, y: number | null) => void;
  reset: () => void;
}

const initialWorldPos: WorldPos = { x: 0, y: 0.55, z: 0 };

const initialState: AetherGameState = {
  phase: 'IDLE',
  playerTile: null,
  playerWorldPos: initialWorldPos,
  targetTile: null,
  pathQueue: [],
  drilledTiles: new Set(),
  hoveredTile: null,
  isDrilling: false,
};

export const useAetherGameStore = create<AetherGameState & AetherGameActions>((set, get) => ({
  ...initialState,

  startGame: () => set({ phase: 'SPAWN_SELECT' }),

  selectSpawn: (x: number, y: number) => {
    const [wx, wy, wz] = tileToWorld(x, y);
    set({
      phase: 'PLAYING',
      playerTile: { x, y },
      playerWorldPos: { x: wx, y: wy, z: wz },
      pathQueue: [],
      targetTile: null,
    });
  },

  setTargetAndMove: (x: number, y: number) => {
    const { phase, playerTile } = get();
    if (phase !== 'PLAYING' && phase !== 'SPAWN_SELECT') return;
    if (phase === 'SPAWN_SELECT') return;
    if (!playerTile) return;
    if (playerTile.x === x && playerTile.y === y) return;

    const path = manhattanPath(playerTile.x, playerTile.y, x, y);
    if (path.length === 0) return;

    set({
      phase: 'MOVING',
      targetTile: { x, y },
      pathQueue: path,
    });
  },

  tickMovement: (deltaMs: number) => {
    const { phase, pathQueue, playerTile, playerWorldPos } = get();
    if (phase !== 'MOVING' || pathQueue.length === 0 || !playerTile) return;

    const next = pathQueue[0];
    const [targetWx, targetWy, targetWz] = tileToWorld(next.x, next.y);
    const dx = targetWx - playerWorldPos.x;
    const dy = targetWy - playerWorldPos.y;
    const dz = targetWz - playerWorldPos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const speed = 2.2; // unidades por segundo
    const step = speed * (deltaMs / 1000);

    if (dist <= step || dist < 0.01) {
      const newQueue = pathQueue.slice(1);
      set({
        playerTile: next,
        playerWorldPos: { x: targetWx, y: targetWy, z: targetWz },
        pathQueue: newQueue,
        ...(newQueue.length === 0 ? { phase: 'PLAYING' as GamePhase, targetTile: null } : {}),
      });
      return;
    }

    const t = step / dist;
    set({
      playerWorldPos: {
        x: playerWorldPos.x + dx * t,
        y: playerWorldPos.y + dy * t,
        z: playerWorldPos.z + dz * t,
      },
    });
  },

  drillCurrentTile: () => {
    const { phase, playerTile, isDrilling } = get();
    if (phase !== 'PLAYING' || !playerTile || isDrilling) return;

    const key = tileKey(playerTile.x, playerTile.y);
    set({ isDrilling: true });
    set((s) => ({
      drilledTiles: new Set(s.drilledTiles).add(key),
    }));

    setTimeout(() => {
      set((s) => {
        const next = new Set(s.drilledTiles);
        next.delete(key);
        return { drilledTiles: next, isDrilling: false };
      });
      // TODO: energía (coste de perforar). TODO: poderes. TODO: DRILL/CLAIM real cuando exista contrato y 2 jugadores (generación del secreto).
    }, DRILL_FEEDBACK_MS);
  },

  setHoveredTile: (x: number | null, y: number | null) => {
    set({
      hoveredTile: x !== null && y !== null ? { x, y } : null,
    });
  },

  reset: () =>
    set({
      ...initialState,
      playerWorldPos: initialWorldPos,
      drilledTiles: new Set(),
    }),
}));
