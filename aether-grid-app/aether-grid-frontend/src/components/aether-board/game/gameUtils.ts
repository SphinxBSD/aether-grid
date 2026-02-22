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

/** Los 8 vecinos (radio 1) de (i, j) dentro del grid */
export function getNeighbors(i: number, j: number): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      if (di === 0 && dj === 0) continue;
      const ni = i + di;
      const nj = j + dj;
      if (ni >= 0 && ni < GRID_SIZE && nj >= 0 && nj < GRID_SIZE) out.push({ x: ni, y: nj });
    }
  }
  return out;
}

export function isNeighbor(ax: number, ay: number, bx: number, by: number): boolean {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return dx <= 1 && dy <= 1 && (dx !== 0 || dy !== 0);
}

/** Path en línea recta horizontal o vertical hasta la casilla destino (para Impulso). Cuesta siempre +2 energía. */
export function straightLinePath(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number
): Array<{ x: number; y: number }> {
  const dx = toX - fromX;
  const dy = toY - fromY;
  if (dx === 0 && dy === 0) return [];
  if (dx !== 0 && dy !== 0) return [];
  const stepX = dx === 0 ? 0 : dx > 0 ? 1 : -1;
  const stepY = dy === 0 ? 0 : dy > 0 ? 1 : -1;
  const path: Array<{ x: number; y: number }> = [];
  let x = fromX;
  let y = fromY;
  while (x !== toX || y !== toY) {
    x += stepX;
    y += stepY;
    if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) return [];
    path.push({ x, y });
  }
  return path;
}

/** Tiles de una fila (index 0..6) */
export function getRowTiles(rowIndex: number): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let j = 0; j < GRID_SIZE; j++) out.push({ x: rowIndex, y: j });
  return out;
}

/** Tiles de una columna (index 0..6) */
export function getColTiles(colIndex: number): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < GRID_SIZE; i++) out.push({ x: i, y: colIndex });
  return out;
}
