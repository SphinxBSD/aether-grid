import { useRef, useLayoutEffect, useMemo } from 'react';
import type { InstancedMesh } from 'three';
import { Object3D } from 'three';
import type { MapTile } from '../mapData';
import { tileCenter, tileTopY, mulberry32, SEED } from './utils';

export interface RockInstancesProps {
  tiles: MapTile[];
}

export function RockInstances({ tiles }: RockInstancesProps) {
  const ref = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);

  const rockData = useMemo(() => {
    const rand = mulberry32(SEED + 1);
    return tiles
      .filter((t) => t.type === 'stone' || t.type === 'sand' || t.type === 'rock')
      .filter(() => rand() < 0.35)
      .map((t) => {
        const [x, , z] = tileCenter(t.position[0], t.position[2]);
        const scale = 0.12 + rand() * 0.14;
        const rotY = rand() * Math.PI * 2;
        const rotX = (rand() - 0.5) * 0.4;
        const rotZ = (rand() - 0.5) * 0.4;
        return { x, z, scale, rotY, rotX, rotZ };
      });
  }, [tiles]);

  useLayoutEffect(() => {
    if (!ref.current || rockData.length === 0) return;
    rockData.forEach((d, i) => {
      dummy.position.set(d.x, tileTopY + d.scale * 0.6, d.z);
      dummy.scale.set(d.scale, d.scale * 0.85, d.scale * 1.1);
      dummy.rotation.set(d.rotX, d.rotY, d.rotZ);
      dummy.updateMatrix();
      ref.current!.setMatrixAt(i, dummy.matrix);
    });
    ref.current!.instanceMatrix.needsUpdate = true;
  }, [dummy, rockData]);

  if (rockData.length === 0) return null;

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, rockData.length]} castShadow receiveShadow>
      <sphereGeometry args={[1, 6, 5]} />
      <meshStandardMaterial color="#5c534a" roughness={0.98} metalness={0} />
    </instancedMesh>
  );
}
