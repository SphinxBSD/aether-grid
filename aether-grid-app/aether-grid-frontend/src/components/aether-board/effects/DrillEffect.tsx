import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Mesh, Group } from 'three';
import { TILE_SIZE } from '../constants';
import { tileToWorld } from '../game/gameUtils';
import type { DrillEffectState } from '../game/gameStore';

const DURATION_MS = 700;

interface DrillEffectProps {
  effect: DrillEffectState | null;
}

export function DrillEffect({ effect }: DrillEffectProps) {
  const ringRef = useRef<Mesh>(null);
  const particlesRef = useRef<Group>(null);

  useFrame(() => {
    if (!effect) return;
    const elapsed = performance.now() - effect.startTime;
    const t = Math.min(1, elapsed / DURATION_MS);

    if (ringRef.current) {
      const scale = 0.4 + t * 1.4;
      const opacity = t < 0.5 ? t * 1.2 : 1.2 * (1 - t);
      ringRef.current.scale.setScalar(scale);
      (ringRef.current.material as { opacity: number }).opacity = Math.max(0, opacity);
    }

    if (effect.result && particlesRef.current) {
      particlesRef.current.visible = t > 0.3;
      const pt = (t - 0.3) / 0.7;
      particlesRef.current.children.forEach((c, i) => {
        const mesh = c as Mesh;
        const o = 1 - pt + (i * 0.1);
        (mesh.material as { opacity: number }).opacity = Math.max(0, o);
        mesh.position.y = pt * 0.8 + (i % 3) * 0.1;
      });
    }
  });

  if (!effect) return null;

  const [wx, wy, wz] = tileToWorld(effect.x, effect.y);
  const color = effect.result ? '#00ffaa' : '#ff3300';

  return (
    <group position={[wx, wy, wz]}>
      <mesh ref={ringRef} position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[TILE_SIZE * 0.35, TILE_SIZE * 0.85, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.8} depthWrite={false} side={2} />
      </mesh>
      {effect.result && (
        <group ref={particlesRef} visible={false}>
          {[0, 1, 2, 3, 4].map((i) => (
            <mesh key={i} position={[(i - 2) * 0.15, 0, ((i % 2) - 0.5) * 0.2]}>
              <boxGeometry args={[0.08, 0.08, 0.08]} />
              <meshBasicMaterial color="#00d4ff" transparent opacity={0.9} />
            </mesh>
          ))}
        </group>
      )}
    </group>
  );
}
