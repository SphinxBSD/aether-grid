import type { MapTile } from './mapData';
import { AsteroidBase } from './AsteroidBase';
import { BoardTiles } from './boardTiles';
import { MapObjects } from './mapObjects';

export interface BoardContentProps {
  /** Datos del mapa (tiles). Punto único de entrada para ampliar con más objetos después. */
  map: MapTile[];
}

export function BoardContent({ map }: BoardContentProps) {
  return (
    <group>
      <AsteroidBase />
      <BoardTiles map={map} />
      <MapObjects map={map} />
    </group>
  );
}
