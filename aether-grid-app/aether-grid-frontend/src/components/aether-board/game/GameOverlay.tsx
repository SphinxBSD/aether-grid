import { useAetherGameStore, type GamePhase, type ActivePower } from './gameStore';
import './GameOverlay.css';

const phaseLabels: Record<GamePhase, string> = {
  IDLE: '',
  SPAWN_SELECT: 'Elige tu posición inicial',
  PLAYING: 'Haz click en una casilla o usa un poder',
  MOVING: 'Moviendo...',
  FINISHED: '¡Encontraste el objeto!',
};

const POWER_LABELS: Record<ActivePower, string> = {
  MOVE: 'Mover',
  RADAR: 'Radar',
  SCAN: 'Escáner',
  IMPULSE: 'Impulso',
  DRILL: 'Perforar',
};

export function GameOverlay() {
  const {
    phase,
    startGame,
    drillCurrentTile,
    energy,
    radarUses,
    scanUses,
    impulseUses,
    activePower,
    setActivePower,
    setRadarUses,
    setScanUses,
    setImpulseUses,
    impulseBlockDrill,
    isDrilling,
    scanMode,
    setScanMode,
    scanIndex,
    setScanIndex,
    executeScan,
    lastMessage,
    lastMessageAt,
    actionLog,
  } = useAetherGameStore();

  const canDrill = phase === 'PLAYING' && !isDrilling && !impulseBlockDrill;
  const showPowers = phase === 'PLAYING' || phase === 'MOVING';
  const messageAge = typeof lastMessageAt === 'number' ? performance.now() - lastMessageAt : 9999;
  const showMessage = lastMessage && messageAge < 3000;

  return (
    <div className="aether-overlay">
      {phase === 'IDLE' && (
        <div className="aether-overlay-start">
          <button type="button" className="aether-btn aether-btn--start" onClick={startGame}>
            Empezar
          </button>
        </div>
      )}

      {(phase === 'SPAWN_SELECT' || phase === 'PLAYING' || phase === 'MOVING' || phase === 'FINISHED') && (
        <aside className="aether-console">
          <div className="aether-console-header">
            <span className="aether-console-title">SISTEMA</span>
            <span className="aether-console-badge">AETHER</span>
          </div>

          <div className="aether-console-section">
            <div className="aether-console-label">Estado</div>
            <p className="aether-status">
              {phase === 'FINISHED' ? phaseLabels.FINISHED : phaseLabels[phase]}
            </p>
          </div>

          {(showPowers || phase === 'FINISHED') && (
            <>
              <div className="aether-console-section aether-console-section--energy">
                <div className="aether-console-label">Energía acumulada</div>
                <div className="aether-console-value aether-console-value--energy">{energy}</div>
                <div className="aether-console-hint">(menor gana)</div>
              </div>

              {showPowers && (
                <>
                  <div className="aether-console-section aether-console-section--tools">
                    <div className="aether-console-label">Herramienta</div>
                    <div className="aether-powers">
                      <button
                        type="button"
                        className={`aether-btn aether-btn--power ${activePower === 'MOVE' ? 'aether-btn--power-active' : ''}`}
                        onClick={() => setActivePower('MOVE')}
                      >
                        {POWER_LABELS.MOVE}
                      </button>
                      <button
                        type="button"
                        className={`aether-btn aether-btn--drill ${canDrill ? '' : 'aether-btn--disabled'}`}
                        onClick={drillCurrentTile}
                        disabled={!canDrill}
                        title="Perforar en la casilla actual"
                      >
                        {POWER_LABELS.DRILL}
                      </button>
                      <button
                        type="button"
                        className={`aether-btn aether-btn--power aether-btn--power-with-uses ${activePower === 'RADAR' ? 'aether-btn--power-active' : ''}`}
                        onClick={() => setActivePower('RADAR')}
                      >
                        {POWER_LABELS.RADAR} <span className="aether-btn-uses">({radarUses})</span>
                      </button>
                      <button
                        type="button"
                        className={`aether-btn aether-btn--power aether-btn--power-with-uses ${activePower === 'SCAN' ? 'aether-btn--power-active' : ''}`}
                        onClick={() => setActivePower('SCAN')}
                      >
                        {POWER_LABELS.SCAN} <span className="aether-btn-uses">({scanUses})</span>
                      </button>
                      <button
                        type="button"
                        className={`aether-btn aether-btn--power aether-btn--power-with-uses ${activePower === 'IMPULSE' ? 'aether-btn--power-active' : ''}`}
                        onClick={() => setActivePower('IMPULSE')}
                      >
                        {POWER_LABELS.IMPULSE} <span className="aether-btn-uses">({impulseUses})</span>
                      </button>
                    </div>
                  </div>

                  {activePower === 'SCAN' && (
                    <div className="aether-console-section aether-console-section--scanner">
                      <div className="aether-scanner-panel">
                        <div className="aether-scanner-mode">
                          <span className="aether-scanner-mode-label">Modo</span>
                          <button
                            type="button"
                            className={`aether-btn aether-btn--scan-mode ${scanMode === 'row' ? 'active' : ''}`}
                            onClick={() => setScanMode('row')}
                          >
                            Fila
                          </button>
                          <button
                            type="button"
                            className={`aether-btn aether-btn--scan-mode ${scanMode === 'col' ? 'active' : ''}`}
                            onClick={() => setScanMode('col')}
                          >
                            Col
                          </button>
                        </div>
                        <div className="aether-scanner-index">
                          <span className="aether-scanner-index-label">Índice 1–7</span>
                          <input
                            type="range"
                            min={0}
                            max={6}
                            value={scanIndex}
                            onChange={(e) => setScanIndex(Number(e.target.value))}
                            className="aether-scanner-slider"
                          />
                          <span className="aether-console-num aether-scanner-index-value">{scanIndex + 1}</span>
                        </div>
                        <button
                          type="button"
                          className="aether-btn aether-btn--scan-exec"
                          onClick={executeScan}
                          disabled={scanUses < 1}
                        >
                          Ejecutar
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="aether-console-section aether-console-section--log">
                    <div className="aether-console-label">Historial</div>
                    <div className="aether-console-log">
                      {actionLog.length === 0 ? (
                        <div className="aether-console-log-empty">—</div>
                      ) : (
                        actionLog.slice().reverse().slice(0, 5).map((line, i) => (
                          <div key={`${i}-${line}`} className="aether-console-log-line">{line}</div>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}

              {showMessage && (
                <div className="aether-console-section aether-console-section--message">
                  <div className="aether-message">{lastMessage}</div>
                </div>
              )}
            </>
          )}
        </aside>
      )}
    </div>
  );
}
