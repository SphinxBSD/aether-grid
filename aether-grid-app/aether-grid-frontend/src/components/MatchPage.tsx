import { useWalletStore } from '@/store/walletSlice';
import { AetherGridGame } from '@/games/aether-grid/AetherGridGame';
import './MatchPage.css';

/** Default points for matches (100.00 with 7 decimals) when not integrated with Game Hub */
const DEFAULT_AVAILABLE_POINTS = 100n * 10n ** 7n;

export function MatchPage() {
  const publicKey = useWalletStore((s) => s.publicKey);

  if (!publicKey) {
    return (
      <div className="match-page">
        <p className="page-description">Connect your wallet to create or join a match.</p>
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
