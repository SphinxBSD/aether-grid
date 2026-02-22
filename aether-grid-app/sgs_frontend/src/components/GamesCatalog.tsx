import { useState } from 'react';

import { useWallet } from '@/hooks/useWallet';
import typezeroHero from '../assets/typezero-hero.png';
import xrayHero from '../assets/xray-hero.png';
import './GamesCatalog.css';

type GameDef = {
  id: string;
  title: string;
  emoji: string;
  description: string;
  tags: string[];
};

const games: GameDef[] = [];

interface GamesCatalogProps {
  onBack?: () => void;
}

export function GamesCatalog({ onBack }: GamesCatalogProps) {
  const [selectedGame, setSelectedGame] = useState<string | null>(null);
  const { publicKey, isConnected, isConnecting, error } = useWallet();

  const userAddress = publicKey ?? '';

  const handleSelectGame = (gameId: string) => {
    setSelectedGame(gameId);
  };

  const handleBackToLibrary = () => {
    setSelectedGame(null);
  };



  return (
    <div className="library-page">
      <div className="library-header">
        {onBack ? (
          <button className="btn-secondary" onClick={onBack}>
            Back to Studio
          </button>
        ) : null}
        <div className="library-intro">
          <h2>Games Library</h2>
          <p>Choose a template to play now or fork into your own title.</p>
        </div>
      </div>

      {!isConnected && (
        <div className="card wallet-banner">
          {error ? (
            <>
              <h3>Wallet Connection Error</h3>
              <p>{error}</p>
            </>
          ) : (
            <>
              <h3>{isConnecting ? 'Connecting...' : 'Connect a Dev Wallet'}</h3>
              <p>Use the switcher above to auto-connect and swap between demo players.</p>
            </>
          )}
        </div>
      )}

      <div className="games-grid">
        {games.map((game, index) => (
          <button
            key={game.id}
            className="game-card"
            type="button"
            disabled={!isConnected}
            onClick={() => handleSelectGame(game.id)}
            style={{ animationDelay: `${index * 120}ms` }}
          >
            <div className="game-card-header">
              <span className="game-emoji">{game.emoji}</span>
              <span className="game-title">{game.title}</span>
            </div>
            <p className="game-description">{game.description}</p>
            <div className="game-tags">
              {game.tags.map((tag) => (
                <span key={tag} className="game-tag">
                  {tag}
                </span>
              ))}
            </div>
            <div className="game-cta">Launch Game</div>
          </button>
        ))}
      </div>

      <section className="zk-section">
        <div className="zk-header">
          <h3>Zero Knowledge Games</h3>
        </div>
        <div className="zk-grid">
          <div className="zk-card">
            <div className="zk-card-text">
              <div className="zk-card-title">TypeZero</div>
              <p className="zk-card-description">
                A typing game built with RISC Zero and Stellar. Requires local setup.
              </p>
              <div className="zk-card-links">
                <a
                  className="zk-card-link"
                  href="https://github.com/jamesbachini/typezero/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Open on GitHub
                </a>
                <a
                  className="zk-card-link"
                  href="https://jamesbachini.com/stellar-risc-zero-games/?dpl_token=20623f91-ba93-4bfb-81b4-d7097ef5811f"
                  target="_blank"
                  rel="noreferrer"
                >
                  Tutorial
                </a>
              </div>
            </div>
            <div className="zk-media">
              <img
                src={typezeroHero}
                alt="TypeZero gameplay screenshot"
                loading="lazy"
              />
            </div>
          </div>
          <div className="zk-card">
            <div className="zk-card-text">
              <div className="zk-card-title">XRay Games</div>
              <p className="zk-card-description">
                A series of games including slicer built with Circom circuits.
              </p>
              <div className="zk-card-links">
                <a
                  className="zk-card-link"
                  href="https://github.com/fredericrezeau/xray-games"
                  target="_blank"
                  rel="noreferrer"
                >
                  OPEN ON GITHUB
                </a>
                <a
                  className="zk-card-link"
                  href="https://kyungj.in/posts/trustless-gaming-stellar-xray-games/"
                  target="_blank"
                  rel="noreferrer"
                >
                  TUTORIAL
                </a>
              </div>
            </div>
            <div className="zk-media">
              <img
                src={xrayHero}
                alt="XRay Games gameplay screenshot"
                loading="lazy"
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
