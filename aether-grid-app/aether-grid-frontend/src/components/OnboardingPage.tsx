import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ONBOARDING_SLIDES,
  TOTAL_SLIDES,
  type OnboardingSlide,
  type Callout,
} from './onboarding/onboardingSlides';
import './OnboardingPage.css';

const SWIPE_THRESHOLD_PX = 60;

export function OnboardingPage() {
  const navigate = useNavigate();
  const [current, setCurrent] = useState(0);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);

  const slide = ONBOARDING_SLIDES[current];
  const isFirst = current === 0;
  const isLast = current === TOTAL_SLIDES - 1;

  const goNext = useCallback(() => {
    if (isLast) {
      navigate('/match', { replace: true });
      return;
    }
    setCurrent((c) => Math.min(c + 1, TOTAL_SLIDES - 1));
  }, [isLast, navigate]);

  const goBack = useCallback(() => {
    setCurrent((c) => Math.max(c - 1, 0));
  }, []);

  const goToMatch = useCallback(() => {
    navigate('/match', { replace: true });
  }, [navigate]);

  const skip = useCallback(() => {
    navigate('/match', { replace: true });
  }, [navigate]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  }, []);

  const onTouchEnd = useCallback(() => {
    if (touchStart == null || touchEnd == null) return;
    const diff = touchStart - touchEnd;
    if (Math.abs(diff) < SWIPE_THRESHOLD_PX) return;
    if (diff > 0) goNext();
    else goBack();
    setTouchStart(null);
    setTouchEnd(null);
  }, [touchStart, touchEnd, goNext, goBack]);

  return (
    <div
      className="onboarding-page"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div className="onboarding-canvas">
        <div
          className="onboarding-slide-bg"
          style={{
            backgroundImage: `url(${slide.image})`,
          }}
        />
        <div className="onboarding-slide-overlay">
          {slide.kind === 'story' && (
            <StoryContent slide={slide} onNext={goNext} onSkip={skip} />
          )}
          {slide.kind === 'mechanics' && (
            <MechanicsContent
              slide={slide}
              onNext={isLast ? goToMatch : goNext}
              onBack={goBack}
              isLast={isLast}
            />
          )}
        </div>
      </div>

      <div className="onboarding-progress">
        <span className="onboarding-progress-text">
          {current + 1}/{TOTAL_SLIDES}
        </span>
      </div>

      <div className="onboarding-nav">
        {!isFirst && (
          <button
            type="button"
            className="onboarding-btn onboarding-btn--secondary"
            onClick={goBack}
            aria-label="Back"
          >
            Back
          </button>
        )}
        <div className="onboarding-nav-spacer" />
        <button
          type="button"
          className="onboarding-btn onboarding-btn--primary"
          onClick={isLast ? goToMatch : goNext}
          aria-label={slide.ctaPrimary}
        >
          {slide.ctaPrimary}
        </button>
      </div>
    </div>
  );
}

function StoryContent({
  slide,
  onNext,
  onSkip,
}: {
  slide: OnboardingSlide;
  onNext: () => void;
  onSkip: () => void;
}) {
  return (
    <>
      <div className="onboarding-story-panel">
        <h2 className="onboarding-title">{slide.title}</h2>
        {slide.body && (
          <p className="onboarding-body">
            {slide.body.split('\n').map((line, i) => (
              <span key={i}>
                {line}
                {i < slide.body!.split('\n').length - 1 && <br />}
              </span>
            ))}
          </p>
        )}
      </div>
      {slide.showSkip && (
        <button
          type="button"
          className="onboarding-skip"
          onClick={onSkip}
          aria-label="Skip tutorial"
        >
          Skip
        </button>
      )}
    </>
  );
}

function MechanicsContent({
  slide,
  onNext,
  onBack,
  isLast,
}: {
  slide: OnboardingSlide;
  onNext: () => void;
  onBack: () => void;
  isLast: boolean;
}) {
  return (
    <>
      <div className="onboarding-mechanics-header">
        {slide.badge && (
          <div className="onboarding-badge">{slide.badge}</div>
        )}
        <h2 className="onboarding-title onboarding-title--mechanics">
          {slide.title}
        </h2>
      </div>
      {slide.callouts?.map((callout, i) => (
        <CalloutBubble key={i} callout={callout} />
      ))}
    </>
  );
}

function CalloutBubble({ callout }: { callout: Callout }) {
  return (
    <div
      className="onboarding-callout"
      style={{
        left: `${callout.left}%`,
        top: `${callout.top}%`,
      }}
      data-pointer={callout.pointer ?? 'right'}
    >
      <div className="onboarding-callout-line" />
      <div className="onboarding-callout-panel">{callout.text}</div>
    </div>
  );
}
