/** Tipo de tile: hierba, agua, árbol, arena, roca (pedazo de tierra en el espacio) */
export type TileType = 'stone' | 'water' | 'tree' | 'sand' | 'rock';

/** Datos de una celda del mapa (position en índices de grid; y siempre 0) */
export interface MapTile {
  id: string;
  position: [number, number, number];
  type: TileType;
  variant: number;
}

const GRID = 8;
const SEED = 42;

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mock del mapa 8x8: pradera, agua, bosque, playa y roca para aspecto "tierra en el espacio" */
export const MAP_MOCK: MapTile[] = (() => {
  const rand = mulberry32(SEED);
  const types: TileType[] = ['stone', 'stone', 'stone', 'water', 'tree', 'sand', 'rock'];
  const out: MapTile[] = [];
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const idx = rand();
      const type = types[Math.floor(idx * types.length)];
      const variant = Math.floor(rand() * 4);
      out.push({
        id: `t-${i}-${j}`,
        position: [i, 0, j],
        type,
        variant,
      });
    }
  }
  return out;
})();
