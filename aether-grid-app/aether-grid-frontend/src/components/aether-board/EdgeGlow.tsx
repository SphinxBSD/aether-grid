import { BASE_HALF } from './constants';

const THICKNESS = 0.12;
const HEIGHT = 0.4;
const LENGTH = BASE_HALF * 2;
const EMISSIVE = '#33ccff';
const EMISSIVE_INTENSITY = 0.6;

export function EdgeGlow() {
  const y = 0.2;
  const half = BASE_HALF + THICKNESS / 2;

  return (
    <group>
      {/* +Z (frente) */}
      <mesh position={[0, y, half]} castShadow={false} receiveShadow={false}>
        <boxGeometry args={[LENGTH + THICKNESS * 2, HEIGHT, THICKNESS]} />
        <meshStandardMaterial
          color={EMISSIVE}
          emissive={EMISSIVE}
          emissiveIntensity={EMISSIVE_INTENSITY}
          roughness={1}
          metalness={0}
        />
      </mesh>
      {/* -Z (atrás) */}
      <mesh position={[0, y, -half]} castShadow={false} receiveShadow={false}>
        <boxGeometry args={[LENGTH + THICKNESS * 2, HEIGHT, THICKNESS]} />
        <meshStandardMaterial
          color={EMISSIVE}
          emissive={EMISSIVE}
          emissiveIntensity={EMISSIVE_INTENSITY}
          roughness={1}
          metalness={0}
        />
      </mesh>
      {/* +X (derecha) */}
      <mesh position={[half, y, 0]} castShadow={false} receiveShadow={false}>
        <boxGeometry args={[THICKNESS, HEIGHT, LENGTH]} />
        <meshStandardMaterial
          color={EMISSIVE}
          emissive={EMISSIVE}
          emissiveIntensity={EMISSIVE_INTENSITY}
          roughness={1}
          metalness={0}
        />
      </mesh>
      {/* -X (izquierda) */}
      <mesh position={[-half, y, 0]} castShadow={false} receiveShadow={false}>
        <boxGeometry args={[THICKNESS, HEIGHT, LENGTH]} />
        <meshStandardMaterial
          color={EMISSIVE}
          emissive={EMISSIVE}
          emissiveIntensity={EMISSIVE_INTENSITY}
          roughness={1}
          metalness={0}
        />
      </mesh>
    </group>
  );
}
