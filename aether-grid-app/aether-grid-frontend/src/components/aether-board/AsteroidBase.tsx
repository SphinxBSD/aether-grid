import { useRef, useLayoutEffect, useMemo } from 'react';
import type { InstancedMesh } from 'three';
import { Object3D, Color, InstancedBufferAttribute } from 'three';
import { BASE_HALF } from './constants';

/** Voxels de la base: forma de asteroide rocoso con variación orgánica */
const VOXEL_SIZE = 0.92;
const LAYERS = 5;
const SEED = 12345;

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Colores roca espacial: grises oscuros, marrones y toques verdosos */
function rockColor(rand: () => number): [number, number, number] {
  const pick = rand();
  if (pick < 0.4) {
    const g = 0.22 + rand() * 0.12;
    return [g * 1.1, g, g * 0.9];
  }
  if (pick < 0.75) {
    const b = 0.18 + rand() * 0.1;
    const r = b * 1.35;
    const g = b * 1.1;
    return [r, g, b];
  }
  const v = 0.2 + rand() * 0.08;
  return [v * 0.95, v * 1.05, v * 0.85];
}

interface Voxel {
  x: number;
  y: number;
  z: number;
  scale: number;
  color: [number, number, number];
}

export function AsteroidBase() {
  const ref = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const voxels = useMemo((): Voxel[] => {
    const rand = mulberry32(SEED);
    const out: Voxel[] = [];
    for (let ly = 0; ly < LAYERS; ly++) {
      const y = -VOXEL_SIZE * (ly + 0.5);
      const shrink = 1 - ly * 0.06;
      const halfX = (BASE_HALF * shrink) / VOXEL_SIZE;
      const halfZ = (BASE_HALF * shrink) / VOXEL_SIZE;
      for (let ix = -halfX; ix <= halfX; ix++) {
        for (let iz = -halfZ; iz <= halfZ; iz++) {
          if (rand() > 0.32) {
            const jitter = 0.2;
            const scale = 0.82 + rand() * 0.28;
            out.push({
              x: ix * VOXEL_SIZE + (rand() - 0.5) * jitter,
              y,
              z: iz * VOXEL_SIZE + (rand() - 0.5) * jitter,
              scale,
              color: rockColor(rand),
            });
          }
        }
      }
    }
    return out;
  }, []);

  useLayoutEffect(() => {
    if (!ref.current || voxels.length === 0) return;
    const mesh = ref.current;
    voxels.forEach((v, i) => {
      dummy.position.set(v.x, v.y, v.z);
      dummy.scale.setScalar(v.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;

    if (!mesh.instanceColor) {
      mesh.instanceColor = new InstancedBufferAttribute(
        new Float32Array(voxels.length * 3),
        3
      );
    }
    voxels.forEach((v, i) => {
      mesh.setColorAt(i, new Color(v.color[0], v.color[1], v.color[2]));
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [dummy, voxels]);

  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, voxels.length]}
      castShadow
      receiveShadow
    >
      <boxGeometry args={[VOXEL_SIZE, VOXEL_SIZE, VOXEL_SIZE]} />
      <meshStandardMaterial
        vertexColors
        color="#3d3a36"
        roughness={0.95}
        metalness={0.05}
      />
    </instancedMesh>
  );
}
