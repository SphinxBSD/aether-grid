import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import { useAetherGameStore } from '../game/gameStore';

/** Astronauta voxel naranja: cuerpo + casco + visor emissive. Bobbing al caminar. */
export function PlayerAvatar() {
  const groupRef = useRef<Group>(null);
  const bobPhase = useRef(0);

  const { playerWorldPos, phase, playerTile } = useAetherGameStore();

  useFrame((_, delta) => {
    if (playerTile == null || !groupRef.current) return;
    groupRef.current.position.set(
      playerWorldPos.x,
      playerWorldPos.y,
      playerWorldPos.z
    );
    const isMoving = phase === 'MOVING';
    if (isMoving) {
      bobPhase.current += delta * 12;
      const bob = Math.sin(bobPhase.current) * 0.04;
      groupRef.current.position.y += bob;
    }
  });

  if (playerTile == null) return null;

  return (
    <group ref={groupRef}>
      {/* Cuerpo: cubo naranja */}
      <mesh position={[0, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.32, 0.4, 0.2]} />
        <meshStandardMaterial color="#e87500" roughness={0.7} metalness={0} />
      </mesh>
      {/* Casco */}
      <mesh position={[0, 0.32, 0]} castShadow>
        <boxGeometry args={[0.28, 0.22, 0.22]} />
        <meshStandardMaterial color="#c96500" roughness={0.6} metalness={0.05} />
      </mesh>
      {/* Visor emissive */}
      <mesh position={[0, 0.34, 0.12]} castShadow>
        <planeGeometry args={[0.14, 0.1]} />
        <meshStandardMaterial
          color="#00d4ff"
          emissive="#00aacc"
          emissiveIntensity={0.6}
          roughness={0.3}
        />
      </mesh>
    </group>
  );
}
