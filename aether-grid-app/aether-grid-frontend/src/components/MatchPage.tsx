import { useWalletStore } from '@/store/walletSlice';
import { AetherGridGame } from '@/games/aether-grid/AetherGridGame';
import './MatchPage.css';

/** Puntos por defecto para partidas (100.00 con 7 decimales) si no hay integración con Game Hub */
const DEFAULT_AVAILABLE_POINTS = 100n * 10n ** 7n;

export function MatchPage() {
  const publicKey = useWalletStore((s) => s.publicKey);

  if (!publicKey) {
    return (
      <div className="match-page">
        <p className="page-description">Conecta tu wallet para crear o unirte a una partida.</p>
      </div>
    );
  }

  return (
    <div className="match-page match-page--game">
      <AetherGridGame
        userAddress={publicKey}
        currentEpoch={0}
        availablePoints={DEFAULT_AVAILABLE_POINTS}
        onStandingsRefresh={() => {}}
        onGameComplete={() => {}}
      />
    </div>
  );
}
