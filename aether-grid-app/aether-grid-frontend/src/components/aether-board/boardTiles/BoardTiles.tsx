import { useMemo } from 'react';
import { MAP_MOCK, type MapTile } from '../mapData';
import { TileLayer } from './TileLayer';
import { TileHitLayer } from './TileHitLayer';
import { TileHighlight } from './TileHighlight';

export interface BoardTilesProps {
  map?: MapTile[];
  onTileClick?: (tile: MapTile) => void;
  onTileHover?: (tile: MapTile | null) => void;
  hoveredTile?: { x: number; y: number } | null;
  drilledTiles?: Set<string>;
  playerTile?: { x: number; y: number } | null;
}

export function BoardTiles({
  map: mapProp,
  onTileClick,
  onTileHover,
  hoveredTile = null,
  drilledTiles = new Set(),
  playerTile = null,
}: BoardTilesProps) {
  const map = mapProp ?? MAP_MOCK;

  const byType = useMemo(() => {
    const stone: MapTile[] = [];
    const water: MapTile[] = [];
    const tree: MapTile[] = [];
    const sand: MapTile[] = [];
    const rock: MapTile[] = [];
    map.forEach((t) => {
      if (t.type === 'stone') stone.push(t);
      else if (t.type === 'water') water.push(t);
      else if (t.type === 'tree') tree.push(t);
      else if (t.type === 'sand') sand.push(t);
      else rock.push(t);
    });
    return { stone, water, tree, sand, rock };
  }, [map]);

  return (
    <>
      <TileLayer tiles={byType.stone} type="stone" />
      <TileLayer tiles={byType.water} type="water" />
      <TileLayer tiles={byType.tree} type="tree" />
      <TileLayer tiles={byType.sand} type="sand" />
      <TileLayer tiles={byType.rock} type="rock" />
      <TileHitLayer map={map} onTileClick={onTileClick} onTileHover={onTileHover} />
      <TileHighlight
        hoveredTile={hoveredTile}
        drilledTiles={drilledTiles}
        playerTile={playerTile}
      />
    </>
  );
}
