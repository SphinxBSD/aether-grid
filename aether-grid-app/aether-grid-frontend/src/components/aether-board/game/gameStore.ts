import { create } from 'zustand';
import {
  tileToWorld,
  manhattanPath,
  tileKey,
  straightLinePath,
  getRowTiles,
  getColTiles,
  getNeighbors,
} from './gameUtils';

const ACTION_LOG_MAX = 25;

export type GamePhase = 'IDLE' | 'SPAWN_SELECT' | 'PLAYING' | 'MOVING' | 'FINISHED';

export type ActivePower = 'MOVE' | 'RADAR' | 'SCAN' | 'IMPULSE' | 'DRILL';

const DRILL_ANIM_MS = 700;
const RADAR_PING_MS = 3000;
const SCAN_LINE_MS = 600;
/** Energía = score ascendente (empieza en 0; gana quien termine con MENOR energía) */
const RADAR_MAX = 6;
const SCAN_MAX = 1;
const IMPULSE_MAX = 2;

export interface TileCoord {
  x: number;
  y: number;
}

export interface WorldPos {
  x: number;
  y: number;
  z: number;
}

/** Efecto temporal: radar ilumina las 8 casillas vecinas (luz verde/roja) */
export interface RadarEffect {
  tiles: Array< { x: number; y: number; result: boolean } >;
  startTime: number;
}

/** Efecto temporal: línea de escáner (fila o columna) */
export interface ScanLineEffect {
  type: 'row' | 'col';
  index: number;
  result: boolean;
  startTime: number;
}

/** Efecto temporal: perforación en un tile */
export interface DrillEffectState {
  x: number;
  y: number;
  result: boolean; // true = acierto
  startTime: number;
}

interface AetherGameState {
  phase: GamePhase;
  playerTile: TileCoord | null;
  playerWorldPos: WorldPos;
  targetTile: TileCoord | null;
  pathQueue: TileCoord[];
  drilledTiles: Set<string>;
  hoveredTile: TileCoord | null;
  isDrilling: boolean;

  // Iteración #2: objeto escondido (DEV, no renderizar)
  hiddenObjectTile: TileCoord | null;

  /** Energía acumulada (score ascendente; menor = mejor) */
  energy: number;
  radarUses: number;
  scanUses: number;
  impulseUses: number;

  activePower: ActivePower;
  /** Bloquea DRILL hasta que termine el movimiento (Impulso) */
  impulseBlockDrill: boolean;
  /** Si el movimiento actual es un dash (impulso) para velocidad/trail */
  isImpulseMove: boolean;

  scanMode: 'row' | 'col';
  scanIndex: number;

  // Efectos temporales (para animaciones)
  radarEffect: RadarEffect | null;
  scanLineEffect: ScanLineEffect | null;
  drillEffect: DrillEffectState | null;
  dashTrailPositions: WorldPos[];

  lastMessage: string;
  lastMessageAt: number;

  /** Historial de acciones para la consola (movimientos, radar, escáner, perforar) */
  actionLog: string[];
}

interface AetherGameActions {
  startGame: () => void;
  selectSpawn: (x: number, y: number) => void;
  setTargetAndMove: (x: number, y: number) => void;
  tickMovement: (deltaMs: number) => void;
  drillCurrentTile: () => void;
  setHoveredTile: (x: number | null, y: number | null) => void;
  setActivePower: (p: ActivePower) => void;
  useRadar: (x: number, y: number) => void;
  setScanMode: (mode: 'row' | 'col') => void;
  setScanIndex: (index: number) => void;
  executeScan: () => void;
  useImpulse: (x: number, y: number) => void;
  setRadarUses: (n: number) => void;
  setScanUses: (n: number) => void;
  setImpulseUses: (n: number) => void;
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
  hiddenObjectTile: null,
  energy: 0,
  radarUses: RADAR_MAX,
  scanUses: SCAN_MAX,
  impulseUses: IMPULSE_MAX,
  activePower: 'MOVE',
  impulseBlockDrill: false,
  isImpulseMove: false,
  scanMode: 'row',
  scanIndex: 0,
  radarEffect: null,
  scanLineEffect: null,
  drillEffect: null,
  dashTrailPositions: [],
  lastMessage: '',
  lastMessageAt: 0,
  actionLog: [],
};

function pushLog(log: string[], entry: string): string[] {
  return [...log.slice(-(ACTION_LOG_MAX - 1)), entry];
}

function pickRandomTileExcluding(exclude: TileCoord): TileCoord {
  const x = Math.floor(Math.random() * 7);
  const y = Math.floor(Math.random() * 7);
  if (x === exclude.x && y === exclude.y) return pickRandomTileExcluding(exclude);
  return { x, y };
}

export const useAetherGameStore = create<AetherGameState & AetherGameActions>((set, get) => ({
  ...initialState,

  startGame: () => set({ phase: 'SPAWN_SELECT' }),

  selectSpawn: (x: number, y: number) => {
    const [wx, wy, wz] = tileToWorld(x, y);
    const spawnTile = { x, y };
    const hiddenObjectTile = pickRandomTileExcluding(spawnTile);
    set((s) => ({
      phase: 'PLAYING',
      playerTile: spawnTile,
      playerWorldPos: { x: wx, y: wy, z: wz },
      pathQueue: [],
      targetTile: null,
      hiddenObjectTile,
      energy: 0,
      radarUses: RADAR_MAX,
      scanUses: SCAN_MAX,
      impulseUses: IMPULSE_MAX,
      impulseBlockDrill: false,
      isImpulseMove: false,
      actionLog: pushLog(s.actionLog, `Spawn en (${x + 1},${y + 1})`),
    }));
  },

  setTargetAndMove: (x: number, y: number) => {
    const { phase, playerTile, activePower, energy, pathQueue } = get();
    if (phase !== 'PLAYING' || !playerTile) return;
    if (playerTile.x === x && playerTile.y === y) return;

    if (activePower === 'IMPULSE') {
      const path = straightLinePath(playerTile.x, playerTile.y, x, y);
      if (path.length === 0 || get().impulseUses < 1) return;
      const destination = path[path.length - 1];
      set((s) => ({
        phase: 'MOVING',
        targetTile: destination,
        pathQueue: path,
        energy: energy + 2,
        impulseUses: s.impulseUses - 1,
        impulseBlockDrill: true,
        isImpulseMove: true,
        actionLog: pushLog(s.actionLog, `Impulso → (${destination.x + 1},${destination.y + 1})`),
      }));
      return;
    }

    if (activePower === 'RADAR') {
      get().useRadar(x, y);
      return;
    }

    const path = manhattanPath(playerTile.x, playerTile.y, x, y);
    if (path.length === 0) return;

    set((s) => ({
      phase: 'MOVING',
      targetTile: { x, y },
      pathQueue: path,
      isImpulseMove: false,
      actionLog: pushLog(s.actionLog, `Mover → (${x + 1},${y + 1})`),
    }));
  },

  tickMovement: (deltaMs: number) => {
    const { phase, pathQueue, playerTile, playerWorldPos, energy, isImpulseMove } = get();
    if (phase !== 'MOVING' || pathQueue.length === 0 || !playerTile) return;

    const speed = isImpulseMove ? 5 : 2.2;
    const next = pathQueue[0];
    const [targetWx, targetWy, targetWz] = tileToWorld(next.x, next.y);
    const dx = targetWx - playerWorldPos.x;
    const dy = targetWy - playerWorldPos.y;
    const dz = targetWz - playerWorldPos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const step = speed * (deltaMs / 1000);

    if (dist <= step || dist < 0.01) {
      const newQueue = pathQueue.slice(1);
      const newEnergy = isImpulseMove ? energy : energy + 1;
      const done = newQueue.length === 0;
      set((s) => ({
        playerTile: next,
        playerWorldPos: { x: targetWx, y: targetWy, z: targetWz },
        pathQueue: newQueue,
        energy: newEnergy,
        ...(done
          ? {
              phase: 'PLAYING' as GamePhase,
              targetTile: null,
              impulseBlockDrill: false,
              isImpulseMove: false,
              dashTrailPositions: [],
              actionLog: pushLog(s.actionLog, `Llegado a (${next.x + 1},${next.y + 1})`),
            }
          : {}),
      }));
      return;
    }

    const t = step / dist;
    const newPos = {
      x: playerWorldPos.x + dx * t,
      y: playerWorldPos.y + dy * t,
      z: playerWorldPos.z + dz * t,
    };
    const trail = isImpulseMove
      ? [...get().dashTrailPositions, newPos].slice(-5)
      : get().dashTrailPositions;
    set({
      playerWorldPos: newPos,
      ...(isImpulseMove ? { dashTrailPositions: trail } : {}),
    });
  },

  drillCurrentTile: () => {
    const { phase, playerTile, isDrilling, energy, impulseBlockDrill, hiddenObjectTile } = get();
    if (phase !== 'PLAYING' || !playerTile || isDrilling || impulseBlockDrill) return;

    const hit = hiddenObjectTile != null && hiddenObjectTile.x === playerTile.x && hiddenObjectTile.y === playerTile.y;
    const add = hit ? 2 : 2 + 3;

    set({ isDrilling: true, energy: energy + add });
    set((s) => ({
      drillEffect: {
        x: playerTile!.x,
        y: playerTile!.y,
        result: hit,
        startTime: performance.now(),
      },
    }));
    set((s) => ({
      drilledTiles: new Set(s.drilledTiles).add(tileKey(playerTile!.x, playerTile!.y)),
    }));

    set((s) => ({
      actionLog: pushLog(s.actionLog, `Perforar (${playerTile.x + 1},${playerTile.y + 1}) → ${hit ? 'Acierto' : 'Fallo'}`),
      lastMessage: hit ? '¡Encontraste el objeto!' : 'Fallaste la perforación',
      lastMessageAt: performance.now(),
    }));

    setTimeout(() => {
      set((s) => {
        const next = new Set(s.drilledTiles);
        next.delete(tileKey(playerTile.x, playerTile.y));
        return {
          drilledTiles: next,
          isDrilling: false,
          ...(hit ? { phase: 'FINISHED' as GamePhase } : {}),
        };
      });
      set((s) => ({ drillEffect: null }));
    }, DRILL_ANIM_MS);
  },

  setHoveredTile: (x: number | null, y: number | null) => {
    set({ hoveredTile: x !== null && y !== null ? { x, y } : null });
  },

  setActivePower: (p: ActivePower) => set({ activePower: p }),

  useRadar: (x: number, y: number) => {
    const { radarUses, energy, hiddenObjectTile } = get();
    if (radarUses < 1) return;
    if (x < 0 || x > 6 || y < 0 || y > 6) return;

    const neighbors = getNeighbors(x, y);
    const tiles = neighbors.map(({ x: nx, y: ny }) => ({
      x: nx,
      y: ny,
      result: hiddenObjectTile != null && hiddenObjectTile.x === nx && hiddenObjectTile.y === ny,
    }));
    const anyHit = tiles.some((t) => t.result);
    set((s) => ({
      radarUses: radarUses - 1,
      energy: energy + 1,
      radarEffect: { tiles, startTime: performance.now() },
      lastMessage: anyHit ? 'Radar → alguna casilla SÍ' : 'Radar → 8 casillas, ninguna SÍ',
      lastMessageAt: performance.now(),
      actionLog: pushLog(s.actionLog, `Radar (${x + 1},${y + 1}) → 8 casillas`),
    }));
    setTimeout(() => set({ radarEffect: null }), RADAR_PING_MS);
  },

  setScanMode: (mode: 'row' | 'col') => set({ scanMode: mode }),
  setScanIndex: (index: number) => set({ scanIndex: Math.max(0, Math.min(6, index)) }),

  executeScan: () => {
    const { scanMode, scanIndex, scanUses, energy, hiddenObjectTile } = get();
    if (scanUses < 1) return;

    const tiles = scanMode === 'row' ? getRowTiles(scanIndex) : getColTiles(scanIndex);
    const result =
      hiddenObjectTile != null &&
      tiles.some((t) => t.x === hiddenObjectTile.x && t.y === hiddenObjectTile.y);

    set((s) => ({
      scanUses: 0,
      energy: energy + 4,
      scanLineEffect: { type: scanMode, index: scanIndex, result, startTime: performance.now() },
      lastMessage: result ? 'Escáner → SÍ' : 'Escáner → NO',
      lastMessageAt: performance.now(),
      actionLog: pushLog(s.actionLog, `Escáner ${scanMode} ${scanIndex + 1} → ${result ? 'SÍ' : 'NO'}`),
    }));
    setTimeout(() => set({ scanLineEffect: null }), SCAN_LINE_MS);
  },

  useImpulse: (x: number, y: number) => {
    get().setTargetAndMove(x, y);
  },

  setRadarUses: (n: number) => set({ radarUses: Math.max(0, Math.min(99, n)) }),
  setScanUses: (n: number) => set({ scanUses: Math.max(0, Math.min(99, n)) }),
  setImpulseUses: (n: number) => set({ impulseUses: Math.max(0, Math.min(99, n)) }),

  reset: () =>
    set({
      ...initialState,
      playerWorldPos: initialWorldPos,
      drilledTiles: new Set(),
      actionLog: [],
    }),
}));
