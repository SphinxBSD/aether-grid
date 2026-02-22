/**
 * Top bar chips: energy (⚡), coin, XLM, and Mission button.
 * Uses Cosmic Neon / Glass UI (Stellar) theme classes.
 */
export function TopChipsBar() {
  return (
    <div className="top-chips-bar" role="group" aria-label="Resources and mission">
      <span className="chip">
        <span className="icon-badge icon-badge--gold" aria-hidden>⚡</span>
        <span>12</span>
      </span>
      <span className="chip">
        <span className="icon-badge icon-badge--gold" aria-hidden>🪙</span>
        <span>0</span>
      </span>
      <span className="chip">
        <span className="icon-badge icon-badge--cyan" aria-hidden>◎</span>
        <span>0 XLM</span>
      </span>
      <button type="button" className="chip chip--mission" aria-label="Open mission">
        <span className="icon-badge icon-badge--gold" aria-hidden>◇</span>
        <span>Mission</span>
      </button>
    </div>
  );
}
