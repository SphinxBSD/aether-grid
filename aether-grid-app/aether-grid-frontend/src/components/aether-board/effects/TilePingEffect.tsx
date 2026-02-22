import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Mesh } from 'three';
import { TILE_SIZE } from '../constants';
import { tileToWorld } from '../game/gameUtils';
import type { RadarEffect } from '../game/gameStore';

const DURATION_MS = 700;

interface TilePingEffectProps {
  effect: RadarEffect | null;
}

export function TilePingEffect({ effect }: TilePingEffectProps) {
  const ringRef = useRef<Mesh>(null);
  const ring2Ref = useRef<Mesh>(null);

  useFrame(() => {
    if (!effect) return;
    const elapsed = performance.now() - effect.startTime;
    const t = Math.min(1, elapsed / DURATION_MS);
    const scale = 0.2 + t * 1.6;
    const opacity = (1 - t) * 0.9;
    const y = TILE_SIZE + 0.02 + t * 0.4;
    if (ringRef.current) {
      ringRef.current.scale.setScalar(scale);
      ringRef.current.position.y = y;
      (ringRef.current.material as { opacity: number }).opacity = opacity;
    }
    if (ring2Ref.current) {
      const scale2 = 0.15 + t * 1.2;
      ring2Ref.current.scale.setScalar(scale2);
      ring2Ref.current.position.y = y - 0.01;
      (ring2Ref.current.material as { opacity: number }).opacity = (1 - t) * 0.5;
    }
  });

  if (!effect) return null;

  const [wx, , wz] = tileToWorld(effect.tiles[0].x, effect.tiles[0].y);
  const color = effect.tiles[0].result ? '#00ffaa' : '#cc4466';

  return (
    <group position={[wx, TILE_SIZE + 0.02, wz]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh ref={ringRef}>
        <ringGeometry args={[TILE_SIZE * 0.15, TILE_SIZE * 0.55, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.8} depthWrite={false} side={2} />
      </mesh>
      <mesh ref={ring2Ref}>
        <ringGeometry args={[TILE_SIZE * 0.35, TILE_SIZE * 0.7, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.4} depthWrite={false} side={2} />
      </mesh>
    </group>
  );
}
