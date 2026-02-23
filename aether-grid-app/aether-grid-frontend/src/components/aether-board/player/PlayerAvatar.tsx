import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import { useAetherGameStore } from '../game/gameStore';

const DRILL_DURATION_MS = 700;

/** Astronauta voxel naranja: cuerpo + casco + visor. Bobbing al caminar. Animación de perforación (anticipación, impacto, retroceso) + herramienta. */
export function PlayerAvatar() {
  const groupRef = useRef<Group>(null);
  const toolRef = useRef<Group>(null);
  const bobPhase = useRef(0);

  const { playerWorldPos, phase, playerTile, isDrilling, drillEffect, matchPlayerNumber } =
    useAetherGameStore();

  const playerColor = matchPlayerNumber === 2 ? '#00b4d8' : '#e87500';
  const playerColorDark = matchPlayerNumber === 2 ? '#0096c7' : '#c96500';
  const visorColor = matchPlayerNumber === 2 ? '#00d4ff' : '#00d4ff';
  const visorEmissive = matchPlayerNumber === 2 ? '#00aacc' : '#00aacc';

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

    if (drillEffect && groupRef.current) {
      const t = (performance.now() - drillEffect.startTime) / DRILL_DURATION_MS;
      if (t >= 1) return;
      let dy = 0;
      if (t < 0.15) dy = -t * 0.08;
      else if (t < 0.35) dy = -0.08 - (t - 0.15) * 0.4;
      else if (t < 0.5) dy = -0.16 + (t - 0.35) * 0.5;
      else dy = -0.075 * (1 - (t - 0.5) / 0.2);
      groupRef.current.position.y += dy;

      if (toolRef.current) {
        toolRef.current.visible = t > 0.1 && t < 0.55;
        const spin = (t - 0.15) * 40;
        toolRef.current.rotation.x = Math.sin(spin) * 0.3;
        toolRef.current.rotation.z = spin * 2;
      }
    }
  });

  if (playerTile == null) return null;

  return (
    <group ref={groupRef}>
      {/* Cuerpo: naranja Jugador 1, cyan Jugador 2 */}
      <mesh position={[0, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.32, 0.4, 0.2]} />
        <meshStandardMaterial color={playerColor} roughness={0.7} metalness={0} />
      </mesh>
      {/* Casco */}
      <mesh position={[0, 0.32, 0]} castShadow>
        <boxGeometry args={[0.28, 0.22, 0.22]} />
        <meshStandardMaterial color={playerColorDark} roughness={0.6} metalness={0.05} />
      </mesh>
      {/* Visor */}
      <mesh position={[0, 0.34, 0.12]} castShadow>
        <planeGeometry args={[0.14, 0.1]} />
        <meshStandardMaterial
          color={visorColor}
          emissive={visorEmissive}
          emissiveIntensity={0.6}
          roughness={0.3}
        />
      </mesh>
      {/* Herramienta taladro (visible durante animación de perforación) */}
      <group ref={toolRef} position={[0.18, 0.2, 0.08]} visible={false}>
        <mesh castShadow>
          <coneGeometry args={[0.06, 0.14, 8]} />
          <meshStandardMaterial color="#555566" metalness={0.4} roughness={0.5} />
        </mesh>
      </group>
    </group>
  );
}
