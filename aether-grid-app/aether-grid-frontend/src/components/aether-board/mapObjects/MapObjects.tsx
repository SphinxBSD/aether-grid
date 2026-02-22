import { useMemo } from 'react';
import type { MapTile } from '../mapData';
import { TreeInstances } from './TreeInstances';
import { RockInstances } from './RockInstances';
import { CrystalInstances } from './CrystalInstances';

export interface MapObjectsProps {
  map: MapTile[];
}

export function MapObjects({ map }: MapObjectsProps) {
  const treeTiles = useMemo(() => map.filter((t) => t.type === 'tree'), [map]);

  return (
    <group>
      <TreeInstances tiles={treeTiles} />
      <RockInstances tiles={map} />
      <CrystalInstances tiles={map} />
    </group>
  );
}
