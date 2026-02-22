import { OrbitControls } from '@react-three/drei';

const TARGET: [number, number, number] = [0, 0, 0];

export function SceneControls() {
  return (
    <OrbitControls
      enableDamping
      dampingFactor={0.05}
      minDistance={6}
      maxDistance={25}
      minPolarAngle={Math.PI * 0.2}
      maxPolarAngle={Math.PI * 0.45}
      target={TARGET}
      enablePan={false}
    />
  );
}
