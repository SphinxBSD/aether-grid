import { useAetherGameStore, type GamePhase } from './gameStore';
import './GameOverlay.css';

const phaseLabels: Record<GamePhase, string> = {
  IDLE: '',
  SPAWN_SELECT: 'Elige tu posición inicial',
  PLAYING: 'Haz click en una casilla para moverte',
  MOVING: 'Moviendo...',
};

export function GameOverlay() {
  const { phase, startGame, drillCurrentTile, isDrilling } = useAetherGameStore();

  const canDrill = phase === 'PLAYING' && !isDrilling;

  return (
    <div className="aether-overlay">
      <div className="aether-overlay-inner">
        {phase === 'IDLE' && (
          <button type="button" className="aether-btn aether-btn--start" onClick={startGame}>
            Empezar
          </button>
        )}

        {(phase === 'SPAWN_SELECT' || phase === 'PLAYING' || phase === 'MOVING') && (
          <p className="aether-status">{phaseLabels[phase]}</p>
        )}

        {phase === 'PLAYING' && (
          <button
            type="button"
            className="aether-btn aether-btn--drill"
            onClick={drillCurrentTile}
            disabled={!canDrill}
          >
            Perforar
          </button>
        )}
      </div>
    </div>
  );
}
