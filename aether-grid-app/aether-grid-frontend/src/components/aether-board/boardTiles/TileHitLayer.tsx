import { useRef, useLayoutEffect } from 'react';
import type { InstancedMesh } from 'three';
import { Object3D } from 'three';
import { TILE_SIZE } from '../constants';
import type { MapTile } from '../mapData';
import { worldPos } from './utils';

export interface TileHitLayerProps {
  map: MapTile[];
  onTileClick?: (tile: MapTile) => void;
  onTileHover?: (tile: MapTile | null) => void;
}

export function TileHitLayer({ map, onTileClick, onTileHover }: TileHitLayerProps) {
  const ref = useRef<InstancedMesh>(null);
  const dummy = new Object3D();

  useLayoutEffect(() => {
    if (!ref.current || map.length === 0) return;
    const mesh = ref.current;
    map.forEach((t, i) => {
      const [x, y, z] = worldPos(t.position[0], t.position[2]);
      dummy.position.set(x, y, z);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [map]);

  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, map.length]}
      position={[0, 0, 0]}
      onPointerDown={(e) => {
        e.stopPropagation();
        const tile = map[e.instanceId ?? 0];
        if (tile) onTileClick?.(tile);
      }}
      onPointerMove={(e) => {
        e.stopPropagation();
        const tile = map[e.instanceId ?? 0] ?? null;
        onTileHover?.(tile);
      }}
      onPointerOut={() => onTileHover?.(null)}
    >
      <boxGeometry args={[TILE_SIZE, TILE_SIZE, TILE_SIZE]} />
      <meshBasicMaterial color="#ffffff" transparent opacity={0} depthWrite={false} />
    </instancedMesh>
  );
}
