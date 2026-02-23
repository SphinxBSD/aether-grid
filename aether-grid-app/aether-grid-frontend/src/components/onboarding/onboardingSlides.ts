export type SlideKind = 'story' | 'mechanics';

export interface Callout {
  text: string;
  /** Position: left percentage (0-100), avoid right panel */
  left: number;
  top: number;
  /** Pointer direction toward target */
  pointer?: 'left' | 'right' | 'top' | 'bottom';
}

export interface OnboardingSlide {
  id: number;
  image: string;
  kind: SlideKind;
  badge?: string;
  title: string;
  body?: string;
  callouts?: Callout[];
  ctaPrimary: string;
  ctaSecondary?: string;
  showSkip?: boolean;
}

const base = '/onboarding';

export const ONBOARDING_SLIDES: OnboardingSlide[] = [
  {
    id: 1,
    image: `${base}/01.png`,
    kind: 'story',
    title: 'AETHER SECTOR: SIGNAL LOST',
    body: "You're an astronaut on a Stellar research station.\nA radiation storm knocked systems offline.\nYour ship is stranded.",
    ctaPrimary: 'Next',
    showSkip: true,
  },
  {
    id: 2,
    image: `${base}/02.png`,
    kind: 'story',
    title: 'FUEL REQUIRED',
    body: "The return engine needs a rare fuel source.\nIt's hidden inside the grid.\nYou can't see it only discover it.",
    ctaPrimary: 'Next',
    showSkip: true,
  },
  {
    id: 3,
    image: `${base}/03.png`,
    kind: 'story',
    title: 'ENERGY IS EVERYTHING',
    body: 'Every action consumes energy.\nMove, scan, drill… everything costs.\nWin by spending the least total energy.',
    ctaPrimary: 'Continue',
    showSkip: true,
  },
  {
    id: 4,
    image: `${base}/04.png`,
    kind: 'mechanics',
    badge: 'STEP 1/8',
    title: 'Choose Your Spawn',
    callouts: [
      { text: 'Click a tile to spawn.', left: 15, top: 35, pointer: 'right' },
      { text: 'Your start position shapes your route.', left: 15, top: 50, pointer: 'right' },
      { text: 'Check the STATUS panel for your turn.', left: 15, top: 65, pointer: 'right' },
    ],
    ctaPrimary: 'Next',
    ctaSecondary: 'Back',
  },
  {
    id: 5,
    image: `${base}/05.png`,
    kind: 'mechanics',
    badge: 'STEP 2/8',
    title: 'Move Carefully',
    callouts: [
      { text: 'Movement is only 4 directions (↑↓←→).', left: 12, top: 38, pointer: 'right' },
      { text: 'Each move costs +1 Energy.', left: 12, top: 52, pointer: 'right' },
      { text: 'Paths follow Manhattan steps.', left: 12, top: 66, pointer: 'right' },
    ],
    ctaPrimary: 'Next',
    ctaSecondary: 'Back',
  },
  {
    id: 6,
    image: `${base}/06.png`,
    kind: 'mechanics',
    badge: 'STEP 3/8',
    title: 'Drill Reveals the Hidden Fuel',
    callouts: [
      { text: 'Drill costs +5 Energy.', left: 14, top: 38, pointer: 'right' },
      { text: 'You can drill only your current tile.', left: 14, top: 52, pointer: 'right' },
      { text: 'Drill is the only way to discover it.', left: 14, top: 66, pointer: 'right' },
    ],
    ctaPrimary: 'Next',
    ctaSecondary: 'Back',
  },
  {
    id: 7,
    image: `${base}/07.png`,
    kind: 'mechanics',
    badge: 'STEP 4/8',
    title: 'Drill Result',
    callouts: [
      { text: 'Success: tile turns GREEN.', left: 14, top: 38, pointer: 'right' },
      { text: 'Fail: you learn nothing energy is wasted.', left: 14, top: 52, pointer: 'right' },
      { text: 'Your total Energy decides the winner.', left: 14, top: 66, pointer: 'right' },
    ],
    ctaPrimary: 'Next',
    ctaSecondary: 'Back',
  },
  {
    id: 8,
    image: `${base}/08.png`,
    kind: 'mechanics',
    badge: 'STEP 5/8',
    title: 'Radar: Check Nearby',
    callouts: [
      { text: 'GREEN: it\'s in that zone.', left: 22, top: 34, pointer: 'right' },
      { text: 'Radar scans one neighboring tile.', left: 12, top: 48, pointer: 'right' },
      { text: 'Use it before spending energy on Drill.', left: 12, top: 62, pointer: 'right' },
    ],
    ctaPrimary: 'Next',
    ctaSecondary: 'Back',
  },
  {
    id: 9,
    image: `${base}/09.png`,
    kind: 'mechanics',
    badge: 'STEP 6/8',
    title: 'Radar: Read the Signal',
    callouts: [
      { text: 'RED: it\'s not in that zone.', left: 14, top: 42, pointer: 'right' },
      { text: 'Combine Radar + Movement to reduce drills.', left: 14, top: 66, pointer: 'right' },
    ],
    ctaPrimary: 'Next',
    ctaSecondary: 'Back',
  },
  {
    id: 10,
    image: `${base}/10.png`,
    kind: 'mechanics',
    badge: 'STEP 7/8',
    title: 'Scanner: Row / Column',
    callouts: [
      { text: 'Scanner costs +4 Energy.', left: 14, top: 38, pointer: 'right' },
      { text: 'Returns Yes/No for a full row/column.', left: 14, top: 52, pointer: 'right' },
      { text: 'Use it to narrow the search fast.', left: 14, top: 66, pointer: 'right' },
    ],
    ctaPrimary: 'Next',
    ctaSecondary: 'Back',
  },
  {
    id: 11,
    image: `${base}/11.png`,
    kind: 'mechanics',
    badge: 'STEP 8/8',
    title: 'Win Condition',
    callouts: [
      { text: 'Win by finding it with the least total Energy.', left: 14, top: 38, pointer: 'right' },
      { text: 'Plan: info → route → drill.', left: 14, top: 52, pointer: 'right' },
      { text: 'Ready. Enter Match.', left: 14, top: 66, pointer: 'right' },
    ],
    ctaPrimary: 'Start Match',
    ctaSecondary: 'Back',
  },
];

export const TOTAL_SLIDES = ONBOARDING_SLIDES.length;
