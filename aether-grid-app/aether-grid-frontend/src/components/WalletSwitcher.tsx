import { useEffect, useRef } from 'react';
import { useWallet } from '../hooks/useWallet';
import { useGameRoleStore } from '../stores/gameRoleStore';
import './WalletSwitcher.css';

export function WalletSwitcher() {
  const {
    publicKey,
    isConnected,
    isConnecting,
    walletType,
    error,
    connectDev,
    switchPlayer,
    getCurrentDevPlayer,
  } = useWallet();

  const currentPlayer = getCurrentDevPlayer();
  const gameRole = useGameRoleStore((s) => s.gameRole);
  const hasAttemptedConnection = useRef(false);

  // En partida usamos el rol del juego (JUGADOR 1/2) para etiqueta y color; si no, el número de dev wallet
  const displayRole = gameRole ?? currentPlayer ?? 1;
  const inGame = gameRole !== null;

  useEffect(() => {
    if (!isConnected && !isConnecting && !hasAttemptedConnection.current) {
      hasAttemptedConnection.current = true;
      connectDev(1).catch(console.error);
    }
  }, [isConnected, isConnecting, connectDev]);

  const handleSwitch = async () => {
    if (walletType !== 'dev') return;

    const nextPlayer = currentPlayer === 1 ? 2 : 1;
    try {
      await switchPlayer(nextPlayer);
    } catch (err) {
      console.error('Failed to switch player:', err);
    }
  };

  if (!isConnected) {
    return (
      <div className="wallet-switcher">
        {error ? (
          <div className="wallet-error">
            <div className="error-title">Connection Failed</div>
            <div className="error-message">{error}</div>
          </div>
        ) : (
          <div className="wallet-status connecting">
            <span className="status-indicator"></span>
            <span className="status-text">Connecting...</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`wallet-switcher wallet-switcher--player${displayRole}`}>
      {error && (
        <div className="wallet-error">
          {error}
        </div>
      )}

      <div className="wallet-info">
        <div className="wallet-status connected">
          <span className="status-indicator"></span>
          <div className="wallet-details">
            <div className="wallet-label wallet-label--full">
              {inGame ? `PLAYER ${displayRole}` : `Connected Player ${currentPlayer ?? displayRole}`}
            </div>
            <div className="wallet-label wallet-label--short">
              {inGame ? `J${displayRole}` : `P${currentPlayer ?? displayRole}`}
            </div>
            <div className="wallet-address">
              {publicKey ? `${publicKey.slice(0, 8)}...${publicKey.slice(-4)}` : ''}
            </div>
          </div>
          {walletType === 'dev' && (
            <button
              onClick={handleSwitch}
              className="switch-button"
              disabled={isConnecting}
            >
              <span className="switch-button-full">
                {inGame ? `Switch to Player ${displayRole === 1 ? 2 : 1}` : `Switch to Player ${currentPlayer === 1 ? 2 : 1}`}
              </span>
              <span className="switch-button-short">Switch</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
