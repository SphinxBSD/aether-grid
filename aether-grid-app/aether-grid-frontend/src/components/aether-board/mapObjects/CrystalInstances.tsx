import { useRef, useLayoutEffect, useMemo } from 'react';
import type { InstancedMesh } from 'three';
import { Object3D } from 'three';
import type { MapTile } from '../mapData';
import { tileCenter, tileTopY, mulberry32, SEED } from './utils';

export interface CrystalInstancesProps {
  tiles: MapTile[];
}

export function CrystalInstances({ tiles }: CrystalInstancesProps) {
  const ref = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);

  const crystalData = useMemo(() => {
    const rand = mulberry32(SEED + 2);
    return tiles
      .filter((t) => t.type === 'stone' && t.variant > 1)
      .filter(() => rand() < 0.25)
      .map((t) => {
        const [x, , z] = tileCenter(t.position[0], t.position[2]);
        const scale = 0.08 + rand() * 0.06;
        const rotY = rand() * Math.PI * 2;
        return { x, z, scale, rotY };
      });
  }, [tiles]);

  useLayoutEffect(() => {
    if (!ref.current || crystalData.length === 0) return;
    crystalData.forEach((d, i) => {
      dummy.position.set(d.x, tileTopY + d.scale * 0.6, d.z);
      dummy.scale.set(d.scale * 0.5, d.scale, d.scale * 0.5);
      dummy.rotation.y = d.rotY;
      dummy.updateMatrix();
      ref.current!.setMatrixAt(i, dummy.matrix);
    });
    ref.current!.instanceMatrix.needsUpdate = true;
  }, [dummy, crystalData]);

  if (crystalData.length === 0) return null;

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, crystalData.length]} castShadow receiveShadow>
      <coneGeometry args={[0.5, 1, 4]} />
      <meshStandardMaterial color="#6b8cae" roughness={0.6} metalness={0.1} emissive="#2a3a50" emissiveIntensity={0.15} />
    </instancedMesh>
  );
}
