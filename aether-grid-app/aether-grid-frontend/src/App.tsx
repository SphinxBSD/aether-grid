import { Navigate, Route, Routes } from 'react-router-dom';
import { config } from './config';
import { Layout } from './components/Layout';
import { HomePage } from './components/HomePage';
import { MatchPage } from './components/MatchPage';
import { RankingPage } from './components/RankingPage';
import { ProfilePage } from './components/ProfilePage';
import { useWallet } from './hooks/useWallet';

const GAME_ID = 'aether-grid';
const GAME_TITLE = import.meta.env.VITE_GAME_TITLE || 'Aether Grid';
const GAME_TAGLINE = import.meta.env.VITE_GAME_TAGLINE || 'On-chain game on Stellar';

export default function App() {
  const { isConnected, isConnecting, error, isDevModeAvailable } = useWallet();
  const contractId = config.contractIds[GAME_ID] || '';
  const hasContract = contractId && contractId !== 'YOUR_CONTRACT_ID';
  const devReady = isDevModeAvailable();

  const notReadyContent = !hasContract ? (
    <div className="card">
      <h3 className="gradient-text">Contract Not Configured</h3>
      <p style={{ color: 'var(--color-ink-muted)', marginTop: '1rem' }}>
        Run <code>bun run setup</code> to deploy and configure testnet contract IDs, or set
        <code>VITE_AETHER_GRID_CONTRACT_ID</code> in the root <code>.env</code>.
      </p>
    </div>
  ) : !devReady ? (
    <div className="card">
      <h3 className="gradient-text">Dev Wallets Missing</h3>
      <p style={{ color: 'var(--color-ink-muted)', marginTop: '0.75rem' }}>
        Run <code>bun run setup</code> to generate dev wallets for Player 1 and Player 2.
      </p>
    </div>
  ) : !isConnected ? (
    <div className="card">
      <h3 className="gradient-text">Connecting Dev Wallet</h3>
      <p style={{ color: 'var(--color-ink-muted)', marginTop: '0.75rem' }}>
        The dev wallet switcher auto-connects Player 1. Use the switcher to toggle players.
      </p>
      {error && <div className="notice error" style={{ marginTop: '1rem' }}>{error}</div>}
      {isConnecting && <div className="notice info" style={{ marginTop: '1rem' }}>Connecting...</div>}
    </div>
  ) : null;

  if (notReadyContent) {
    return (
      <Layout>
        {notReadyContent}
      </Layout>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/home" replace />} />
        <Route path="home" element={<HomePage />} />
        <Route path="match" element={<MatchPage />} />
        <Route path="ranking" element={<RankingPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Route>
    </Routes>
  );
}
