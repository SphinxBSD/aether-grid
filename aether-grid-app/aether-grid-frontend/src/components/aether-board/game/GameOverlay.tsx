import { useEffect, useRef } from 'react';
import { useGameRoleStore } from '@/stores/gameRoleStore';
import { useAetherGameStore, type GamePhase, type ActivePower } from './gameStore';
import './GameOverlay.css';

const phaseLabels: Record<GamePhase, string> = {
  IDLE: '',
  SPAWN_SELECT: 'Choose your starting position',
  PLAYING: 'Move or use a power',
  MOVING: 'Moving...',
  FINISHED: 'You found the object!',
};

const POWER_LABELS: Record<ActivePower, string> = {
  MOVE: 'Move',
  RADAR: 'Radar',
  SCAN: 'Scanner',
  IMPULSE: 'Impulse',
  DRILL: 'Drill',
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
    matchSessionId,
  } = useAetherGameStore();

  const sendStatusText = useGameRoleStore((s) => s.sendStatusText);
  const canDrill = phase === 'PLAYING' && !isDrilling && !impulseBlockDrill;
  const showPowers = phase === 'PLAYING' || phase === 'MOVING';
  const toolsBlocked = phase === 'FINISHED';
  const messageAge = typeof lastMessageAt === 'number' ? performance.now() - lastMessageAt : 9999;
  const showMessage = lastMessage && messageAge < 3000;
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (phase === 'IDLE') startGame();
  }, [phase, startGame]);

  useEffect(() => {
    logContainerRef.current?.scrollTo({ top: logContainerRef.current.scrollHeight, behavior: 'smooth' });
  }, [actionLog.length]);

  return (
    <div className="aether-overlay">
      {(phase === 'SPAWN_SELECT' || phase === 'PLAYING' || phase === 'MOVING' || phase === 'FINISHED') && (
        <aside className="aether-console">
          <div className="aether-console-header">
            <div className="aether-console-header-row">
              <span className="aether-console-title">SYSTEM</span>
              <span className="aether-console-badge">AETHER</span>
            </div>
            {matchSessionId != null && (
              <div className="aether-console-session-id">
                <span className="aether-console-session-id-label">Session ID:</span>
                <span
                  className="aether-console-session-id-value"
                  title="Click to copy"
                  onClick={() => navigator.clipboard?.writeText(String(matchSessionId))}
                  onKeyDown={(e) => e.key === 'Enter' && navigator.clipboard?.writeText(String(matchSessionId))}
                  role="button"
                  tabIndex={0}
                >
                  {matchSessionId}
                </span>
              </div>
            )}
          </div>
          {sendStatusText && (
            <div className="aether-console-section aether-console-section--send-status">
              <p className="aether-console-send-status">{sendStatusText}</p>
            </div>
          )}

          <div className="aether-console-section">
            <div className="aether-console-label">Status</div>
            <p className="aether-status">
              {phase === 'FINISHED' ? phaseLabels.FINISHED : phaseLabels[phase]}
            </p>
          </div>


          {(showPowers || phase === 'FINISHED') && (
            <>
              <div className="aether-console-section aether-console-section--energy">
                <div className="aether-console-label">Energy used</div>
                <div className="aether-console-value aether-console-value--energy">{energy}</div>
              </div>

              <div className={`aether-console-section aether-console-section--tools ${toolsBlocked ? 'aether-console-section--tools-blocked' : ''}`}>
                <div className="aether-console-label">Tool</div>
                <div className="aether-powers">
                  <button
                    type="button"
                    className={`aether-btn aether-btn--power ${activePower === 'MOVE' ? 'aether-btn--power-active' : ''}`}
                    onClick={() => !toolsBlocked && setActivePower('MOVE')}
                    disabled={toolsBlocked}
                    aria-disabled={toolsBlocked}
                  >
                    {POWER_LABELS.MOVE}
                  </button>
                  <button
                    type="button"
                    className={`aether-btn aether-btn--drill ${canDrill && !toolsBlocked ? '' : 'aether-btn--disabled'}`}
                    onClick={drillCurrentTile}
                    disabled={!canDrill || toolsBlocked}
                    title="Drill on current tile"
                  >
                    {POWER_LABELS.DRILL}
                  </button>
                  <button
                    type="button"
                    className={`aether-btn aether-btn--power aether-btn--power-with-uses ${activePower === 'RADAR' ? 'aether-btn--power-active' : ''}`}
                    onClick={() => !toolsBlocked && setActivePower('RADAR')}
                    disabled={toolsBlocked}
                    aria-disabled={toolsBlocked}
                  >
                    {POWER_LABELS.RADAR} <span className="aether-btn-uses">({radarUses})</span>
                  </button>
                  <button
                    type="button"
                    className={`aether-btn aether-btn--power aether-btn--power-with-uses ${activePower === 'SCAN' ? 'aether-btn--power-active' : ''}`}
                    onClick={() => !toolsBlocked && setActivePower('SCAN')}
                    disabled={toolsBlocked}
                    aria-disabled={toolsBlocked}
                  >
                    {POWER_LABELS.SCAN} <span className="aether-btn-uses">({scanUses})</span>
                  </button>
                  <button
                    type="button"
                    className={`aether-btn aether-btn--power aether-btn--power-with-uses ${activePower === 'IMPULSE' ? 'aether-btn--power-active' : ''}`}
                    onClick={() => !toolsBlocked && setActivePower('IMPULSE')}
                    disabled={toolsBlocked}
                    aria-disabled={toolsBlocked}
                  >
                    {POWER_LABELS.IMPULSE} <span className="aether-btn-uses">({impulseUses})</span>
                  </button>
                </div>
              </div>

              {activePower === 'SCAN' && !toolsBlocked && (
                <div className="aether-console-section aether-console-section--scanner">
                  <div className="aether-scanner-panel">
                    <div className="aether-scanner-mode">
                      <span className="aether-scanner-mode-label">Mode</span>
                      <button
                        type="button"
                        className={`aether-btn aether-btn--scan-mode ${scanMode === 'row' ? 'active' : ''}`}
                        onClick={() => setScanMode('row')}
                      >
                        Row
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
                      <span className="aether-scanner-index-label">Index 1–7</span>
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
                          Execute
                        </button>
                      </div>
                    </div>
                  )}

              <div className="aether-console-section aether-console-section--log">
                <div className="aether-console-label">History</div>
                <div className="aether-console-log" ref={logContainerRef}>
                  {actionLog.length === 0 ? (
                    <div className="aether-console-log-empty">—</div>
                  ) : (
                    actionLog.map((line, i) => (
                      <div key={`${i}-${line}`} className="aether-console-log-line">{line}</div>
                    ))
                  )}
                </div>
              </div>

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
