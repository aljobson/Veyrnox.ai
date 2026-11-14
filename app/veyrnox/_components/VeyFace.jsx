import { motion } from 'motion/react';

// Faces and props for Vey's moods (lib/veyMood.js). Drawn in the head's own 160-wide space: eyes sit at
// x 59 and 101, y 55; the mouth sits at y 66-80, inside the visor.
const TEAL = '#38f0d0';
const DIM = '#7aa3a0';
const AMBER = '#EF9F27';
const RED = '#D85A30';
const BLUE = '#5aaee0';
const MOUTH = '#49f3d5';

function OpenEye({ cx, ry = 15, dx = 0, dy = 0 }) {
  return (
    <>
      <ellipse cx={cx} cy="55" rx="10" ry={ry} fill={TEAL} filter="url(#vey-glow)" />
      <ellipse cx={cx + 1 + dx} cy={57 + dy} rx="6" ry={ry - 5} fill="#102328" />
      <circle cx={cx + 4 + dx} cy={52 + dy} r="2.7" fill="white" />
    </>
  );
}

function ArcEye({ cx }) {
  return <path d={`M${cx - 10} 60 Q${cx} 40 ${cx + 10} 60`} fill="none" stroke={TEAL} strokeWidth="5" strokeLinecap="round" />;
}

function SleepEye({ cx }) {
  return <path d={`M${cx - 10} 56 Q${cx} 60 ${cx + 10} 56`} fill="none" stroke={DIM} strokeWidth="5" strokeLinecap="round" />;
}

function Brow({ d }) {
  return <path d={d} fill="none" stroke={TEAL} strokeWidth="3" strokeLinecap="round" />;
}

const MOUTHS = {
  big: <path d="M68 67 Q80 88 92 67Z" fill={MOUTH} stroke={MOUTH} strokeWidth="3" strokeLinejoin="round" />,
  flat: <path d="M72 74 H88" fill="none" stroke={MOUTH} strokeWidth="4" strokeLinecap="round" />,
  frown: <path d="M71 78 Q80 69 89 78" fill="none" stroke={MOUTH} strokeWidth="4" strokeLinecap="round" />,
  o: <ellipse cx="80" cy="74" rx="4" ry="5" fill="none" stroke={MOUTH} strokeWidth="3" />,
  wobble: <path d="M69 76 Q74.5 70 80 76 T91 76" fill="none" stroke={MOUTH} strokeWidth="3.5" strokeLinecap="round" />,
  dim: <path d="M74 74 H86" fill="none" stroke={DIM} strokeWidth="3" strokeLinecap="round" />,
};

function Sparkle({ x, y, s }) {
  return <path d={`M${x} ${y - s} Q${x} ${y} ${x + s} ${y} Q${x} ${y} ${x} ${y + s} Q${x} ${y} ${x - s} ${y} Q${x} ${y} ${x} ${y - s}Z`} fill={AMBER} />;
}

function Coin({ x, y, r, hollow, symbol }) {
  return (
    <>
      <circle cx={x} cy={y} r={r} fill={hollow ? 'none' : AMBER} stroke={AMBER} strokeWidth="2" strokeDasharray={hollow ? '3 3' : undefined} />
      <text x={x} y={y + 4} textAnchor="middle" fontSize="11" fill={hollow ? AMBER : '#412402'}>{symbol}</text>
    </>
  );
}

// Each mood: eyes, optional brows, mouth, an optional head tilt, and a prop drawn beside the figure.
export const VEY_FACES = {
  happy: {
    eyes: <><ArcEye cx={59} /><ArcEye cx={101} /></>,
    mouth: MOUTHS.big,
    prop: <><Sparkle x={20} y={28} s={8} /><Sparkle x={144} y={24} s={6} /></>,
  },
  patient: {
    blink: true,
    eyes: <><OpenEye cx={59} dx={3} dy={-3} /><OpenEye cx={101} dx={3} dy={-3} /></>,
    mouth: MOUTHS.flat,
    prop: <><circle cx="134" cy="16" r="3" fill={TEAL} /><circle cx="144" cy="12" r="4" fill={TEAL} opacity="0.7" /><circle cx="155" cy="8" r="5" fill={TEAL} opacity="0.4" /></>,
  },
  sorry: {
    blink: true,
    eyes: <><OpenEye cx={59} ry={13} /><OpenEye cx={101} ry={13} /></>,
    brows: <><Brow d="M49 41 L68 33" /><Brow d="M92 33 L111 41" /></>,
    mouth: MOUTHS.frown,
    prop: <><path d="M138 26 Q144 35 138 42 Q132 35 138 26Z" fill={BLUE} /><Coin x={136} y={106} r={9} symbol="+" /></>,
  },
  broke: {
    blink: true,
    eyes: <><OpenEye cx={59} ry={17} /><OpenEye cx={101} ry={17} /></>,
    brows: <><Brow d="M49 38 L68 31" /><Brow d="M92 31 L111 38" /></>,
    mouth: MOUTHS.wobble,
    prop: <Coin x={136} y={100} r={10} hollow symbol="0" />,
  },
  curious: {
    blink: true,
    tilt: -7,
    eyes: <><OpenEye cx={59} dx={-2} dy={1} /><OpenEye cx={101} dx={-2} dy={1} /></>,
    brows: <><Brow d="M49 33 Q59 27 68 33" /><Brow d="M92 36 H111" /></>,
    mouth: MOUTHS.o,
    prop: <><rect x="6" y="12" width="26" height="20" rx="3" fill="none" stroke={AMBER} strokeWidth="2" strokeDasharray="3 3" /><text x="19" y="27" textAnchor="middle" fontSize="12" fill={AMBER}>?</text></>,
  },
  welcome: {
    blink: true,
    eyes: <><OpenEye cx={59} ry={16} /><OpenEye cx={101} ry={16} /></>,
    mouth: MOUTHS.big,
    prop: <path d="M128 46 Q133 40 128 34 M134 50 Q142 40 134 30" fill="none" stroke={TEAL} strokeWidth="2" strokeLinecap="round" />,
  },
  playful: {
    eyes: <><OpenEye cx={59} /><ArcEye cx={101} /></>,
    mouth: MOUTHS.big,
    prop: <><Coin x={138} y={24} r={11} symbol="+" /><Sparkle x={18} y={30} s={7} /></>,
  },
  sleepy: {
    eyes: <><SleepEye cx={59} /><SleepEye cx={101} /></>,
    mouth: MOUTHS.dim,
    prop: <><path d="M126 20 Q138 8 150 20 M131 26 Q138 20 145 26" fill="none" stroke="#888780" strokeWidth="2.5" strokeLinecap="round" /><circle cx="138" cy="32" r="2" fill="#888780" /><path d="M124 36 L152 6" stroke={RED} strokeWidth="2.5" strokeLinecap="round" /><text x="26" y="24" fontSize="12" fill="#888780">z</text><text x="14" y="36" fontSize="11" fill="#888780">z</text></>,
  },
  firm: {
    blink: true,
    eyes: <><OpenEye cx={59} ry={12} /><OpenEye cx={101} ry={12} /></>,
    brows: <><Brow d="M49 32 L68 40" /><Brow d="M92 40 L111 32" /></>,
    mouth: MOUTHS.flat,
    prop: <><path d="M22 12 L36 17 V31 Q36 43 22 48 Q8 43 8 31 V17Z" fill="none" stroke={RED} strokeWidth="2.5" strokeLinejoin="round" /><path d="M22 22 V34" stroke={RED} strokeWidth="3" strokeLinecap="round" /><circle cx="22" cy="40" r="1.8" fill={RED} /></>,
  },
};

// The face inside the head: eyes, brows and mouth for one mood.
export function VeyFace({ mood, reducedMotion }) {
  const face = VEY_FACES[mood];
  if (!face) return null;
  return (
    <g data-part="face" data-vey-mood={mood}>
      <motion.g
        data-part="eyes"
        animate={face.blink && !reducedMotion ? { scaleY: [1, 1, 0.12, 1, 1] } : { scaleY: 1 }}
        style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
        transition={{ duration: 4.4, times: [0, 0.42, 0.46, 0.5, 1], repeat: Infinity }}
      >
        {face.eyes}
      </motion.g>
      {face.brows}
      {face.mouth}
    </g>
  );
}

// The prop beside the figure (sparkles, coin, shield...). Static, so it is safe under reduced motion.
export function VeyMoodProp({ mood }) {
  const face = VEY_FACES[mood];
  return face ? <g data-part="mood-prop" aria-hidden="true">{face.prop}</g> : null;
}
