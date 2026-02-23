import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { WalletSwitcher } from './WalletSwitcher';
// import { TopChipsBar } from './TopChipsBar';
import './Layout.css';

interface LayoutProps {
  children?: React.ReactNode;
}

const navItems = [
  { id: 'onboarding', label: 'Onboarding', path: '/onboarding', icon: 'onboarding' },
  { id: 'match', label: 'Match', path: '/match', icon: 'match' },
  // Challenges: commented out for now (visual + route)
  // { id: 'challenges', label: 'Challenges', path: '/challenges', icon: 'challenges' },
] as const;

function NavIcon({ name }: { name: (typeof navItems)[number]['icon'] }) {
  const size = 22;
  switch (name) {
    case 'onboarding':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
          <path d="M12 8v4" />
          <path d="M12 16h.01" />
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
    // case 'challenges':
    //   return (
    //     <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    //       <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
    //       <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
    //       <path d="M4 22h16" />
    //       <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
    //       <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
    //       <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    //     </svg>
    //   );
    default:
      return null;
  }
}

export function Layout({ children }: LayoutProps) {
  const { pathname } = useLocation();
  const isOnboardingOrChallenges = pathname === '/onboarding' || pathname === '/challenges';

  return (
    <div className={`appShell ${isOnboardingOrChallenges ? 'appShell--darkScrim' : ''}`}>
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
          <div className="appNav-brand">
            <img src="/logo.png" alt="Aether Grid" className="appNav-logo" />
          </div>
          <ul className="appNav-list">
            {navItems.map((item) => (
              <li key={item.id}>
                <NavLink
                  to={item.path}
                  className={({ isActive }) =>
                    `appNav-item ${isActive ? 'appNav-item--active' : ''}`
                  }
                  end
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
          <footer className="appNav-footer">
            <span className="appNav-footer-text">
              Hecho con mucho amor por{' '}
              <a href="https://github.com/SphinxBSD" target="_blank" rel="noopener noreferrer" className="appNav-footer-link">SphinxBSD</a>
              {' · '}
              <a href="https://github.com/aleregex" target="_blank" rel="noopener noreferrer" className="appNav-footer-link">aleregex</a>
            </span>
          </footer>
        </div>
      </nav>
    </div>
  );
}
