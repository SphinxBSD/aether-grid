import { Canvas } from '@react-three/fiber';
import { MAP_MOCK } from './mapData';
import { BoardContent } from './BoardContent';
import { SceneCamera, SceneControls, SceneLighting } from './scene';

export function AetherBoardScene() {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      gl={{ antialias: true }}
    >
      <SceneCamera />
      <SceneLighting />
      <SceneControls />
      <BoardContent map={MAP_MOCK} />
    </Canvas>
  );
}
