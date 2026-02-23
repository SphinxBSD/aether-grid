import { useRef, useLayoutEffect, useMemo } from 'react';
import type { InstancedMesh } from 'three';
import { Object3D, Color, InstancedBufferAttribute } from 'three';
import { TILE_SIZE } from '../constants';
import type { MapTile, TileType } from '../mapData';
import { worldPos, colorFor } from './utils';

export interface TileLayerProps {
  tiles: MapTile[];
  type: TileType;
}

export function TileLayer({ tiles, type }: TileLayerProps) {
  const ref = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const count = tiles.length;

  useLayoutEffect(() => {
    if (!ref.current || count === 0) return;
    const mesh = ref.current;
    tiles.forEach((t, i) => {
      const [x, y, z] = worldPos(t.position[0], t.position[2]);
      dummy.position.set(x, y, z);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;

    if (!mesh.instanceColor) {
      mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(count * 3), 3);
    }
    tiles.forEach((t, i) => {
      const [r, g, b] = colorFor(t.type, t.variant);
      mesh.setColorAt(i, new Color(r, g, b));
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [dummy, tiles, count]);

  if (count === 0) return null;

  const isWater = type === 'water';
  const isMineral = type === 'tree'; // tipo "tree" = recurso mineral/cristal en tema espacial
  const isSand = type === 'sand';

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]} castShadow receiveShadow>
      <boxGeometry args={[TILE_SIZE, TILE_SIZE, TILE_SIZE]} />
      <meshStandardMaterial
        color="#ffffff"
        vertexColors
        roughness={isMineral ? 0.75 : isWater ? 0.8 : isSand ? 0.95 : 0.88}
        metalness={isMineral ? 0.15 : 0}
        emissive={isWater ? '#1a3a5c' : isMineral ? '#0d1520' : '#000000'}
        emissiveIntensity={isWater ? 0.06 : isMineral ? 0.03 : 0}
      />
    </instancedMesh>
  );
}
