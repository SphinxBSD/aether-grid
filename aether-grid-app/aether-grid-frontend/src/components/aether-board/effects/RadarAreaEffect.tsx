import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Mesh } from 'three';
import { TILE_SIZE } from '../constants';
import { tileToWorld } from '../game/gameUtils';
import type { RadarEffect } from '../game/gameStore';

const DURATION_MS = 3000;
const FADE_OUT_START = 2600;

interface RadarAreaEffectProps {
  effect: RadarEffect | null;
}

export function RadarAreaEffect({ effect }: RadarAreaEffectProps) {
  const meshRefs = useRef<(Mesh | null)[]>([]);

  useFrame(() => {
    if (!effect) return;
    const elapsed = performance.now() - effect.startTime;
    const t = Math.min(1, elapsed / DURATION_MS);
    const fadeIn = Math.min(1, elapsed / 200);
    const fadeOut = elapsed >= FADE_OUT_START
      ? 1 - (elapsed - FADE_OUT_START) / (DURATION_MS - FADE_OUT_START)
      : 1;
    const opacity = 0.5 * fadeIn * fadeOut;
    effect.tiles.forEach((_, i) => {
      const mesh = meshRefs.current[i];
      if (mesh?.material) (mesh.material as { opacity: number }).opacity = opacity;
    });
  });

  if (!effect || effect.tiles.length === 0) return null;

  const zoneHasObject = effect.tiles.some((t) => t.result);
  const color = zoneHasObject ? '#00cc88' : '#aa4444';

  const size = TILE_SIZE * 1.05;

  return (
    <group>
      {effect.tiles.map(({ x, y }, i) => {
        const [wx, , wz] = tileToWorld(x, y);
        return (
          <mesh
            key={`${x}-${y}`}
            ref={(el) => { meshRefs.current[i] = el; }}
            position={[wx, TILE_SIZE + 0.015, wz]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <planeGeometry args={[size, size]} />
            <meshBasicMaterial
              color={color}
              transparent
              opacity={0.5}
              depthWrite={false}
            />
          </mesh>
        );
      })}
    </group>
  );
}
