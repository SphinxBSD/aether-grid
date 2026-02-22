import { useRef, useLayoutEffect, useMemo } from 'react';
import type { InstancedMesh } from 'three';
import { Object3D } from 'three';
import type { MapTile } from '../mapData';
import { tileCenter, tileTopY, mulberry32, SEED } from './utils';

export interface TreeInstancesProps {
  tiles: MapTile[];
}

export function TreeInstances({ tiles }: TreeInstancesProps) {
  const trunkRef = useRef<InstancedMesh>(null);
  const foliageRef = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);

  const treeData = useMemo(() => {
    const rand = mulberry32(SEED);
    return tiles.map((t) => {
      const [x, , z] = tileCenter(t.position[0], t.position[2]);
      const height = 0.35 + rand() * 0.2;
      const foliageScale = 0.28 + rand() * 0.12;
      const rotY = rand() * Math.PI * 2;
      return { x, z, height, foliageScale, rotY };
    });
  }, [tiles]);

  useLayoutEffect(() => {
    if (!trunkRef.current || !foliageRef.current || treeData.length === 0) return;
    treeData.forEach((d, i) => {
      dummy.position.set(d.x, tileTopY + d.height / 2, d.z);
      dummy.scale.set(0.08, d.height, 0.08);
      dummy.rotation.y = d.rotY;
      dummy.updateMatrix();
      trunkRef.current!.setMatrixAt(i, dummy.matrix);
      dummy.position.set(d.x, tileTopY + d.height + d.foliageScale * 0.5, d.z);
      dummy.scale.setScalar(d.foliageScale);
      dummy.rotation.y = d.rotY * 0.7;
      dummy.updateMatrix();
      foliageRef.current!.setMatrixAt(i, dummy.matrix);
    });
    trunkRef.current!.instanceMatrix.needsUpdate = true;
    foliageRef.current!.instanceMatrix.needsUpdate = true;
  }, [dummy, treeData]);

  if (treeData.length === 0) return null;

  return (
    <>
      <instancedMesh ref={trunkRef} args={[undefined, undefined, treeData.length]} castShadow receiveShadow>
        <cylinderGeometry args={[1, 1.1, 1, 6]} />
        <meshStandardMaterial color="#4a3728" roughness={0.95} metalness={0} />
      </instancedMesh>
      <instancedMesh ref={foliageRef} args={[undefined, undefined, treeData.length]} castShadow receiveShadow>
        <coneGeometry args={[1, 1.2, 6]} />
        <meshStandardMaterial color="#1a4d2e" roughness={0.9} metalness={0} />
      </instancedMesh>
    </>
  );
}
