import { useRef, useLayoutEffect, useMemo } from 'react';
import type { InstancedMesh } from 'three';
import { Object3D } from 'three';
import type { MapTile } from '../mapData';
import { tileCenter, tileTopY, mulberry32, SEED } from './utils';

export interface TreeInstancesProps {
  tiles: MapTile[];
}

/** Un solo cristal prismático (posición, escala, rotación). */
interface CrystalInstance {
  x: number;
  z: number;
  height: number;
  radius: number;
  rotY: number;
  rotX: number;
}

const CRYSTALS_PER_TILE = 6; // racimo: 1 central + varios alrededor

/** Árboles del espacio: racimos de cristales prismáticos translúcidos (estilo hielo/cuarzo). */
export function TreeInstances({ tiles }: TreeInstancesProps) {
  const meshRef = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);

  const crystalData = useMemo(() => {
    const rand = mulberry32(SEED);
    const out: CrystalInstance[] = [];
    tiles.forEach((t) => {
      const [cx, , cz] = tileCenter(t.position[0], t.position[2]);
      const baseRot = rand() * Math.PI * 2;
      for (let k = 0; k < CRYSTALS_PER_TILE; k++) {
        const isCentral = k === 0;
        const angle = isCentral ? 0 : (k / CRYSTALS_PER_TILE) * Math.PI * 2 + rand() * 0.5;
        const dist = isCentral ? 0 : 0.08 + rand() * 0.1;
        const x = cx + Math.cos(angle) * dist;
        const z = cz + Math.sin(angle) * dist;
        const height = isCentral ? 0.4 + rand() * 0.2 : 0.15 + rand() * 0.25;
        const radius = isCentral ? 0.06 + rand() * 0.04 : 0.03 + rand() * 0.035;
        const rotY = baseRot + rand() * 0.6;
        const rotX = (rand() - 0.5) * 0.3;
        out.push({ x, z, height, radius, rotY, rotX });
      }
    });
    return out;
  }, [tiles]);

  useLayoutEffect(() => {
    if (!meshRef.current || crystalData.length === 0) return;
    const mesh = meshRef.current;
    crystalData.forEach((d, i) => {
      const y = tileTopY + d.height / 2;
      dummy.position.set(d.x, y, d.z);
      dummy.scale.set(d.radius, d.height, d.radius);
      dummy.rotation.y = d.rotY;
      dummy.rotation.x = d.rotX;
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [dummy, crystalData]);

  if (crystalData.length === 0) return null;

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, crystalData.length]} castShadow receiveShadow>
      <coneGeometry args={[1, 3, 6]} />
      <meshPhysicalMaterial
        color="#b0c4d8"
        roughness={0.08}
        metalness={0.05}
        transmission={0.82}
        thickness={0.15}
        ior={1.35}
        envMapIntensity={0.9}
        transparent
        opacity={0.95}
      />
    </instancedMesh>
  );
}
