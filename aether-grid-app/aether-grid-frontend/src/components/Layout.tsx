import { NavLink, Outlet } from 'react-router-dom';
import { WalletSwitcher } from './WalletSwitcher';
import './Layout.css';

interface LayoutProps {
  title?: string;
  subtitle?: string;
  children?: React.ReactNode;
}

const navItems = [
  { id: 'home', label: 'Home', path: '/home', icon: 'home' },
  { id: 'match', label: 'Match', path: '/match', icon: 'match' },
  { id: 'ranking', label: 'Ranking', path: '/ranking', icon: 'ranking' },
  { id: 'profile', label: 'Profile', path: '/profile', icon: 'profile' },
] as const;

function NavIcon({ name }: { name: (typeof navItems)[number]['icon'] }) {
  const size = 22;
  switch (name) {
    case 'home':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      );
    case 'match':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5" />
        </svg>
      );
    case 'ranking':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 20V10" />
          <path d="M18 20V4" />
          <path d="M6 20v-4" />
        </svg>
      );
    case 'profile':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      );
    default:
      return null;
  }
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

      <header className="appHeader">
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
        {children ?? <Outlet />}
      </main>

      <nav className="appNav" aria-label="Primary navigation">
        <div className="appNav-inner">
          <ul className="appNav-list">
            {navItems.map((item) => (
              <li key={item.id}>
                <NavLink
                  to={item.path}
                  className={({ isActive }) =>
                    `appNav-item ${isActive ? 'appNav-item--active' : ''}`
                  }
                  end={item.path === '/home'}
                  aria-current={undefined}
                >
                  <span className="appNav-icon">
                    <NavIcon name={item.icon} />
                  </span>
                  <span className="appNav-label">{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      </nav>
    </div>
  );
}
