import { GRID_SIZE, TILE_SIZE } from '../constants';
import type { TileType } from '../mapData';

export const half = (GRID_SIZE * TILE_SIZE) / 2;
export const halfTile = TILE_SIZE / 2;

export function worldPos(i: number, j: number): [number, number, number] {
  const x = (i + 0.5) * TILE_SIZE - half;
  const z = (j + 0.5) * TILE_SIZE - half;
  return [x, halfTile, z];
}

/** Colores: pradera, agua, mineral/cristal, arena, roca (tema espacial) */
export function colorFor(type: TileType, variant: number): [number, number, number] {
  switch (type) {
    case 'stone': {
      const g = 0.58 + variant * 0.12;
      const r = 0.25 + variant * 0.08;
      const b = 0.15 + variant * 0.06;
      return [r, g, b];
    }
    case 'water': {
      const b = 0.75 + variant * 0.08;
      const g = 0.55 + variant * 0.1;
      const r = 0.2 + variant * 0.06;
      return [r, g, b];
    }
    case 'tree': {
      // Carbón / mineral espacial: grises oscuros con toque azul
      const base = 0.14 + variant * 0.06;
      const b = 0.22 + variant * 0.08;
      const g = 0.16 + variant * 0.05;
      const r = base;
      return [r, g, b];
    }
    case 'sand': {
      const t = 0.85 + variant * 0.04;
      return [t * 0.9, t * 0.82, t * 0.6];
    }
    case 'rock': {
      const v = 0.35 + variant * 0.08;
      return [v * 0.9, v * 0.85, v * 0.75];
    }
  }
}
