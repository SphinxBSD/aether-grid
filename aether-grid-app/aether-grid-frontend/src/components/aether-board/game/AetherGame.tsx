import { useEffect, useRef } from 'react';
import { GameOverlay } from './GameOverlay';
import { AetherBoardScene } from '../AetherBoardScene';
import { useAetherGameStore } from './gameStore';

/**
 * Wrapper del MVP interactivo: overlay UI (Empezar, Perforar, estado) + escena 3D.
 * Si onFinish está definido (modo partida on-chain), se llama con la energía final cuando el jugador termina (phase FINISHED).
 */
export interface AetherGameProps {
  /** Llamado cuando el jugador encuentra el objeto; recibe la energía acumulada. Solo se invoca una vez. */
  onFinish?: (energy: number) => void;
  /** Si es true, no llamar onFinish (p. ej. acabamos de restaurar estado y no debemos enviar tx por el otro jugador). */
  skipNextFinishRef?: React.MutableRefObject<boolean>;
}

export function AetherGame({ onFinish, skipNextFinishRef }: AetherGameProps = {}) {
  const phase = useAetherGameStore((s) => s.phase);
  const energy = useAetherGameStore((s) => s.energy);
  const onFinishCalled = useRef(false);

  useEffect(() => {
    if (phase !== 'FINISHED') {
      onFinishCalled.current = false;
      return;
    }
    if (skipNextFinishRef?.current) {
      skipNextFinishRef.current = false;
      return;
    }
    if (onFinish && !onFinishCalled.current) {
      onFinishCalled.current = true;
      onFinish(energy);
    }
  }, [onFinish, phase, energy, skipNextFinishRef]);

  return (
    <div className="aether-game" style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      <GameOverlay />
      <AetherBoardScene />
    </div>
  );
}
