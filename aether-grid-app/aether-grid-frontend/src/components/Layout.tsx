import { WalletSwitcher } from './WalletSwitcher';
import './Layout.css';

interface LayoutProps {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
}

export function Layout({ title, subtitle, children }: LayoutProps) {
  const resolvedTitle = title || import.meta.env.VITE_GAME_TITLE || 'Stellar Game';
  const resolvedSubtitle = subtitle || import.meta.env.VITE_GAME_TAGLINE || 'Testnet dev sandbox';

  return (
    <div className="appShell">
      <div className="appShell-background" aria-hidden="true">
        <div className="appShell-orb orb-1" />
        <div className="appShell-orb orb-2" />
        <div className="appShell-orb orb-3" />
        <div className="appShell-grid" />
      </div>

      <header className="appHeader bg-blue-500">
        <div className="appHeader-brand">
          <h1 className="appHeader-title">{resolvedTitle}</h1>
          <p className="appHeader-subtitle">{resolvedSubtitle}</p>
        </div>
        <div className="appHeader-actions">
          <span className="appHeader-pill">Testnet</span>
          <span className="appHeader-pill appHeader-pill--dev">Dev Wallets</span>
          <WalletSwitcher />
        </div>
      </header>

      <main className="appMain" id="main-content">
        {children}
      </main>

      <nav className="appNav" aria-label="Primary navigation">
        <div className="appNav-inner bg-red-500 h-full">
          {/* <WalletSwitcher /> */}
          NAVIGATION
        </div>
      </nav>
    </div>
  );
}
