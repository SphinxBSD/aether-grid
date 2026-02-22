/** Tamaño del grid del tablero (NxN) */
export const GRID_SIZE = 8;
/** Tamaño de cada tile (cubo) */
export const TILE_SIZE = 1;
/** Unidades que la base sobresale respecto al grid (por lado) */
export const BASE_PADDING = 2;

/** Mitad del ancho del tablero en unidades */
export const BOARD_HALF = (GRID_SIZE * TILE_SIZE) / 3;
/** Mitad del ancho de la base (tablero + padding) */
export const BASE_HALF = BOARD_HALF + BASE_PADDING;
