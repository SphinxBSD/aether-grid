import { useFrame } from '@react-three/fiber';
import { useAetherGameStore } from './gameStore';

/** Llama a tickMovement cada frame para animar el camino del jugador. */
export function GameLoop() {
  useFrame((_, delta) => {
    useAetherGameStore.getState().tickMovement(delta * 1000);
  });
  return null;
}
