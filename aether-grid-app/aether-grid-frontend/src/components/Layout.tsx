import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { WalletSwitcher } from './WalletSwitcher';
// import { TopChipsBar } from './TopChipsBar';
import './Layout.css';

interface LayoutProps {
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
    case 'match':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    default:
      return null;
  }
}

export function Layout({ children }: LayoutProps) {
  const { pathname } = useLocation();
  const isProfileOrRanking = pathname === '/profile' || pathname === '/ranking';

  return (
    <div className={`appShell ${isProfileOrRanking ? 'appShell--darkScrim' : ''}`}>
      <header className="appHeader">
        <div className="appHeader-brand">
          {/* <h1 className="appHeader-title">{resolvedTitle}</h1> */}
          {/* <p className="appHeader-subtitle">{resolvedSubtitle}</p> */}
        </div>
        <div className="appHeader-actions">
          {/* <TopChipsBar /> */}
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
