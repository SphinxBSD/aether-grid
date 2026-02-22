import { GRID_SIZE, TILE_SIZE } from '../constants';

/** Centro del tile en mundo (X,Z). Y para avatar = encima del tile */
export function tileToWorld(i: number, j: number): [number, number, number] {
  const half = (GRID_SIZE - 1) / 2;
  const x = (i - half) * TILE_SIZE;
  const z = (j - half) * TILE_SIZE;
  const y = TILE_SIZE + 0.25; // encima del tile
  return [x, y, z];
}

/** Convierte coordenadas mundo a índices de tile (redondeado al centro) */
export function worldToTile(worldX: number, worldZ: number): [number, number] {
  const half = (GRID_SIZE - 1) / 2;
  const i = Math.round(worldX / TILE_SIZE + half);
  const j = Math.round(worldZ / TILE_SIZE + half);
  return [Math.max(0, Math.min(GRID_SIZE - 1, i)), Math.max(0, Math.min(GRID_SIZE - 1, j))];
}

/** Clave única por tile para Sets */
export function tileKey(i: number, j: number): string {
  return `${i}-${j}`;
}

/** Path Manhattan (solo 4 direcciones N/S/E/O) de (px,py) a (tx,ty) */
export function manhattanPath(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number
): Array<{ x: number; y: number }> {
  if (fromX === toX && fromY === toY) return [];
  const path: Array<{ x: number; y: number }> = [];
  let x = fromX;
  let y = fromY;
  while (x !== toX) {
    x += x < toX ? 1 : -1;
    path.push({ x, y });
  }
  while (y !== toY) {
    y += y < toY ? 1 : -1;
    path.push({ x, y });
  }
  return path;
}
