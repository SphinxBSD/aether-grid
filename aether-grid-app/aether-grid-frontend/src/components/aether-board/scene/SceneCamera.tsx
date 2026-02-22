import { PerspectiveCamera } from '@react-three/drei';

const CAMERA_POSITION: [number, number, number] = [10, 10, 10];
const FOV = 45;

export function SceneCamera() {
  return (
    <PerspectiveCamera makeDefault position={CAMERA_POSITION} fov={FOV} />
  );
}
