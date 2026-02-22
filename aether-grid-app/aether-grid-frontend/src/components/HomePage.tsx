import './HomePage.css';
import { AetherBoardScene } from './aether-board';

export function HomePage() {
  return (
    <div className="home-page">
      <div className="home-page-bg" aria-hidden="true" />
      <div className="home-page-scrim" aria-hidden="true" />
      <div className="home-page-content">
        <AetherBoardScene />
      </div>
    </div>
  );
}
