import { GRID_SIZE, TILE_SIZE } from '../constants';

export const half = (GRID_SIZE * TILE_SIZE) / 2;
export const tileTopY = TILE_SIZE;

export function tileCenter(i: number, j: number): [number, number, number] {
  const x = (i + 0.5) * TILE_SIZE - half;
  const z = (j + 0.5) * TILE_SIZE - half;
  return [x, tileTopY, z];
}

export const SEED = 9999;

export function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
