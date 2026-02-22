import { GameOverlay } from './GameOverlay';
import { AetherBoardScene } from '../AetherBoardScene';

/**
 * Wrapper del MVP interactivo: overlay UI (Empezar, Perforar, estado) + escena 3D.
 * TODO: energía, poderes, DRILL real cuando exista contrato y 2 jugadores.
 */
export function AetherGame() {
  return (
    <div className="aether-game" style={{ position: 'relative', width: '100%', height: '100%' }}>
      <GameOverlay />
      <AetherBoardScene />
    </div>
  );
}
