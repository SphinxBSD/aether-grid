import { useMemo } from 'react';
import { MAP_MOCK, type MapTile } from '../mapData';
import { TileLayer } from './TileLayer';

export interface BoardTilesProps {
  map?: MapTile[];
}

export function BoardTiles({ map: mapProp }: BoardTilesProps) {
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
    </>
  );
}
