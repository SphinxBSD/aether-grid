import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Mesh } from 'three';
import { GRID_SIZE, TILE_SIZE } from '../constants';
import { tileToWorld } from '../game/gameUtils';
import type { ScanLineEffect } from '../game/gameStore';

const DURATION_MS = 600;

interface LineScanEffectProps {
  effect: ScanLineEffect | null;
}

export function LineScanEffect({ effect }: LineScanEffectProps) {
  const meshRef = useRef<Mesh>(null);

  useFrame(() => {
    if (!effect || !meshRef.current) return;
    const elapsed = performance.now() - effect.startTime;
    const t = Math.min(1, elapsed / DURATION_MS);
    const mat = meshRef.current.material as { opacity: number };
    mat.opacity = 0.5 * (1 - t * 0.8);
  });

  if (!effect) return null;

  const isRow = effect.type === 'row';
  const half = (GRID_SIZE - 1) / 2;
  const centerX = isRow ? (effect.index - half) * TILE_SIZE : 0;
  const centerZ = isRow ? 0 : (effect.index - half) * TILE_SIZE;
  const width = isRow ? TILE_SIZE * 1.2 : GRID_SIZE * TILE_SIZE;
  const depth = isRow ? GRID_SIZE * TILE_SIZE : TILE_SIZE * 1.2;
  const color = effect.result ? '#00cc88' : '#aa4444';

  return (
    <mesh
      ref={meshRef}
      position={[centerX, TILE_SIZE + 0.015, centerZ]}
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <planeGeometry args={[width, depth]} />
      <meshBasicMaterial color={color} transparent opacity={0.5} depthWrite={false} />
    </mesh>
  );
}
