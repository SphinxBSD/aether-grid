import './HomePage.css';
import { AetherGame } from './aether-board';

export function HomePage() {
  return (
    <div className="home-page">
      <div className="home-page-content">
        <AetherGame />
      </div>
    </div>
  );
}
