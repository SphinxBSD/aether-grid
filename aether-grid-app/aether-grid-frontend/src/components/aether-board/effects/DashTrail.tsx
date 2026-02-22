import type { WorldPos } from '../game/gameStore';

interface DashTrailProps {
  positions: WorldPos[];
}

/** 2-3 fantasmas detrás del personaje durante el dash (opacidad decreciente) */
export function DashTrail({ positions }: DashTrailProps) {
  if (positions.length === 0) return null;

  const trail = positions.slice(-3);
  return (
    <group>
      {trail.map((pos, i) => {
        const opacity = 0.4 - i * 0.12;
        return (
          <mesh key={`${pos.x}-${pos.y}-${pos.z}-${i}`} position={[pos.x, pos.y, pos.z]}>
            <boxGeometry args={[0.28, 0.35, 0.18]} />
            <meshBasicMaterial color="#e87500" transparent opacity={opacity} depthWrite={false} />
          </mesh>
        );
      })}
    </group>
  );
}
