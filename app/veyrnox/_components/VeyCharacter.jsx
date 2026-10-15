import { AnimatePresence, motion } from 'motion/react';
import { VEY_SHOULDER } from '../../../lib/veyPointer';

const LOOP = { duration: 1.8, repeat: Infinity, ease: 'easeInOut' };
const QUICK_LOOP = { duration: 0.52, repeat: Infinity, ease: 'easeInOut' };

function animated(reducedMotion, active, still) {
  return reducedMotion ? still : active;
}

export default function VeyCharacter({ pose = 'idle', reducedMotion = false, hand = null }) {
  const walking = pose === 'walking';
  const pointing = pose === 'guiding' || pose === 'tapping';
  const tapping = pose === 'tapping';
  const thinking = pose === 'thinking';
  const listening = pose === 'listening';
  const aimed = pointing && hand;
  const dx = hand ? hand.x - VEY_SHOULDER.x : 0, dy = hand ? hand.y - VEY_SHOULDER.y : 0;
  const reach = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;

  const headAnimation = animated(reducedMotion,
    thinking
      ? { rotate: [-4, 5, -4], y: [0, -2, 0] }
      : walking
        ? { rotate: [-3, 3, -3], y: [0, -3, 0] }
        : pointing
          ? { rotate: [0, 4, 0], y: [0, -1, 0] }
          : { rotate: [-1.5, 1.5, -1.5], y: [0, -2, 0] },
    { rotate: pointing ? 4 : 0, y: 0 });

  const leftArmAnimation = animated(reducedMotion,
    walking
      ? { rotate: [24, -18, 24] }
      : listening
        ? { rotate: [-8, -28, -8] }
        : thinking
          ? { rotate: [2, 10, 2] }
          : { rotate: [5, -5, 5] },
    { rotate: listening ? -18 : 0 });

  const rightArmAnimation = animated(reducedMotion,
    tapping
      ? { rotate: [-34, -39, -34], x: [0, 5, 0] }
      : pointing
        ? { rotate: [-34, -30, -34] }
        : thinking
          ? { rotate: [-58, -64, -58], x: [-2, 0, -2] }
          : walking
            ? { rotate: [-18, 24, -18] }
            : { rotate: [12, 5, 12] },
    { rotate: pointing ? -34 : thinking ? -60 : 8 });

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 160 170"
      className="pointer-events-none h-full w-full overflow-visible drop-shadow-[0_12px_22px_rgb(0_0_0/0.34)]"
      data-vey-pose={pose}
    >
      <defs>
        <linearGradient id="vey-shell" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.55" stopColor="#dbe8ea" />
          <stop offset="1" stopColor="#91b4b7" />
        </linearGradient>
        <linearGradient id="vey-aqua" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7effec" />
          <stop offset="0.55" stopColor="#23e6c3" />
          <stop offset="1" stopColor="#009f91" />
        </linearGradient>
        <radialGradient id="vey-visor" cx="50%" cy="25%" r="85%">
          <stop offset="0" stopColor="#26343a" />
          <stop offset="0.5" stopColor="#0a1115" />
          <stop offset="1" stopColor="#020607" />
        </radialGradient>
        <filter id="vey-glow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="2.2" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      <motion.ellipse
        cx="80" cy="157" rx="39" ry="7"
        fill="rgb(0 0 0 / 0.32)"
        animate={animated(reducedMotion, walking ? { rx: [33, 42, 33], opacity: [0.26, 0.38, 0.26] } : { rx: [36, 39, 36] }, { rx: 39 })}
        transition={walking ? QUICK_LOOP : LOOP}
      />

      <motion.g
        data-part="left-leg"
        style={{ transformBox: 'fill-box', transformOrigin: 'top center' }}
        animate={animated(reducedMotion, walking ? { rotate: [-24, 24, -24], y: [0, -2, 0] } : { rotate: [0, 5, 0] }, { rotate: 0 })}
        transition={walking ? QUICK_LOOP : LOOP}
      >
        <circle cx="64" cy="126" r="8" fill="#172329" stroke="#83a5aa" strokeWidth="2" />
        <path d="M61 131 C55 138 53 148 57 155 C60 161 70 160 73 151 L74 140 C73 134 67 130 61 131Z" fill="url(#vey-shell)" stroke="#75999d" strokeWidth="2" />
        <path d="M57 148 C61 151 68 152 73 149 L72 154 C68 162 59 161 57 155Z" fill="url(#vey-aqua)" />
      </motion.g>

      <motion.g
        data-part="right-leg"
        style={{ transformBox: 'fill-box', transformOrigin: 'top center' }}
        animate={animated(reducedMotion, walking ? { rotate: [24, -24, 24], y: [-2, 0, -2] } : { rotate: [0, -5, 0] }, { rotate: 0 })}
        transition={walking ? QUICK_LOOP : LOOP}
      >
        <circle cx="96" cy="126" r="8" fill="#172329" stroke="#83a5aa" strokeWidth="2" />
        <path d="M88 139 C87 133 92 129 98 130 C106 132 109 142 105 152 C101 160 91 160 88 153Z" fill="url(#vey-shell)" stroke="#75999d" strokeWidth="2" />
        <path d="M89 148 C94 151 101 151 106 147 L105 153 C102 161 93 160 89 154Z" fill="url(#vey-aqua)" />
      </motion.g>

      <motion.g
        data-part="left-arm"
        style={{ transformBox: 'fill-box', transformOrigin: 'right center' }}
        animate={leftArmAnimation}
        transition={walking ? QUICK_LOOP : LOOP}
      >
        <path d="M51 84 C40 83 34 90 27 99" fill="none" stroke="#172329" strokeWidth="13" strokeLinecap="round" />
        <path d="M48 84 C39 83 34 90 29 96" fill="none" stroke="#718f94" strokeWidth="3" strokeLinecap="round" opacity="0.75" />
        <path d="M30 94 C25 92 19 95 17 101 C16 107 20 112 26 112 C32 111 36 104 35 99Z" fill="url(#vey-shell)" stroke="#789b9f" strokeWidth="2" />
        <path d="M20 101 C24 104 30 105 34 101" fill="none" stroke="#1ee6c2" strokeWidth="3" />
        <motion.g
          data-part="left-hand"
          style={{ transformBox: 'fill-box', transformOrigin: 'right center' }}
          animate={animated(reducedMotion, listening ? { rotate: [-10, 14, -10] } : { rotate: [0, -4, 0] }, { rotate: listening ? 8 : 0 })}
          transition={listening ? { duration: 0.75, repeat: Infinity, ease: 'easeInOut' } : LOOP}
        >
          <path d="M18 99 C10 96 4 99 5 104 C6 107 10 108 14 107 C8 110 8 114 11 116 C14 118 19 114 22 111 C19 116 22 119 25 118 C30 116 31 108 28 104Z" fill="#172329" stroke="#6b858b" strokeWidth="1.5" />
          <path d="M9 103 L18 105 M12 112 L21 108 M22 116 L25 108" stroke="#92adb1" strokeWidth="1" strokeLinecap="round" />
        </motion.g>
      </motion.g>

      {aimed ? <g data-part="aimed-arm" transform={`translate(${VEY_SHOULDER.x} ${VEY_SHOULDER.y}) rotate(${angle})`}>
        <path d={`M0 0 L${Math.max(0, reach - 20)} 0`} fill="none" stroke="#172329" strokeWidth="13" strokeLinecap="round" />
        <path d={`M0 -2 L${Math.max(0, reach - 20)} -2`} fill="none" stroke="#718f94" strokeWidth="3" strokeLinecap="round" />
        <g data-part="pointing-hand" transform={`translate(${reach} 0)`}>
          <path d="M-24 -6 Q-28 -8 -29 -2 Q-30 6 -22 9 L-14 9 Q-9 9 -10 4 L-8 3 L0 0 Q2 -2 -1 -4 L-17 -3 L-17 -7 Q-20 -10 -24 -6Z" fill="url(#vey-shell)" stroke="#789b9f" strokeWidth="1.5" />
          <circle data-testid="assistant-fingertip" cx="0" cy="0" r="2" fill="#23e6c3" />
        </g>
      </g> : <motion.g
        data-part="right-arm"
        style={{ transformBox: 'fill-box', transformOrigin: 'left center' }}
        animate={rightArmAnimation}
        transition={tapping ? { duration: 0.36, repeat: Infinity, ease: 'easeInOut' } : walking ? QUICK_LOOP : LOOP}
      >
        <path d="M108 85 C120 83 128 78 136 69" fill="none" stroke="#172329" strokeWidth="13" strokeLinecap="round" />
        <path d="M111 83 C121 82 128 76 134 70" fill="none" stroke="#718f94" strokeWidth="3" strokeLinecap="round" opacity="0.75" />
        <path d="M132 70 C130 64 133 59 139 57 C145 56 150 60 151 66 C151 72 145 77 139 76Z" fill="url(#vey-shell)" stroke="#789b9f" strokeWidth="2" />
        <path d="M133 64 C138 67 144 66 149 63" fill="none" stroke="#1ee6c2" strokeWidth="3" />
        <motion.g
          data-part="right-hand"
          style={{ transformBox: 'fill-box', transformOrigin: 'left bottom' }}
          animate={animated(reducedMotion, tapping ? { x: [0, 5, 0], rotate: [0, -3, 0] } : { rotate: [0, 3, 0] }, { x: tapping ? 4 : 0 })}
          transition={tapping ? { duration: 0.36, repeat: Infinity, ease: 'easeInOut' } : LOOP}
        >
          <path d="M139 59 C137 54 139 50 143 50 C146 50 147 53 146 56 L153 48 C156 45 160 48 158 52 L151 62 C149 68 143 72 138 69 C134 67 134 62 139 59Z" fill="#172329" stroke="#6b858b" strokeWidth="1.5" />
          <path d="M146 56 L151 61 M149 53 L154 58" stroke="#92adb1" strokeWidth="1" strokeLinecap="round" />
        </motion.g>
      </motion.g>}

      <motion.g
        data-part="body"
        animate={animated(reducedMotion, walking ? { y: [0, -4, 0], rotate: [-1, 1, -1] } : { y: [0, -2, 0] }, { y: 0 })}
        transition={walking ? QUICK_LOOP : LOOP}
      >
        <path d="M48 78 C51 68 64 63 80 63 C96 63 109 68 112 78 L116 105 C116 124 102 137 80 138 C58 137 44 124 44 105Z" fill="url(#vey-shell)" stroke="#7fa3a7" strokeWidth="2.5" />
        <path d="M48 94 C57 101 68 105 80 105 C93 105 104 101 112 94 L113 107 C111 124 99 133 80 134 C61 133 49 124 47 107Z" fill="#c7d9db" opacity="0.62" />
        <circle cx="80" cy="112" r="14" fill="#111b20" stroke="#76979b" strokeWidth="2" />
        <motion.circle
          cx="80" cy="112" r="8"
          fill="url(#vey-aqua)"
          filter="url(#vey-glow)"
          animate={animated(reducedMotion, thinking ? { scale: [0.75, 1.18, 0.75], opacity: [0.75, 1, 0.75] } : { scale: [0.92, 1.08, 0.92] }, { scale: 1 })}
          style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
          transition={thinking ? { duration: 0.82, repeat: Infinity, ease: 'easeInOut' } : LOOP}
        />
      </motion.g>

      <motion.g
        data-part="head"
        style={{ transformBox: 'fill-box', transformOrigin: 'center bottom' }}
        animate={headAnimation}
        transition={thinking ? { duration: 0.72, repeat: Infinity, ease: 'easeInOut' } : walking ? QUICK_LOOP : LOOP}
      >
        <path d="M28 28 C34 10 55 9 80 31 C105 9 126 10 132 28 C139 53 121 86 81 96 C40 86 21 53 28 28Z" fill="url(#vey-shell)" stroke="#83a6aa" strokeWidth="2.5" />
        <path d="M36 30 C42 18 56 18 80 40 C104 18 118 18 124 30 C131 50 114 77 80 85 C46 77 29 50 36 30Z" fill="url(#vey-visor)" stroke="#1ee6c2" strokeWidth="2" />
        <path d="M39 25 C48 14 61 21 79 38" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" opacity="0.58" />

        <motion.g
          data-part="eyes"
          animate={animated(reducedMotion, { scaleY: [1, 1, 0.12, 1, 1] }, { scaleY: 1 })}
          style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
          transition={{ duration: thinking ? 2.5 : 4.4, times: [0, 0.42, 0.46, 0.5, 1], repeat: Infinity }}
        >
          <ellipse cx="59" cy="55" rx="10" ry="15" fill="#38f0d0" filter="url(#vey-glow)" />
          <ellipse cx="101" cy="55" rx="10" ry="15" fill="#38f0d0" filter="url(#vey-glow)" />
          <ellipse cx="60" cy="57" rx="6" ry="10" fill="#102328" />
          <ellipse cx="100" cy="57" rx="6" ry="10" fill="#102328" />
          <circle cx="63" cy="52" r="2.7" fill="white" />
          <circle cx="103" cy="52" r="2.7" fill="white" />
        </motion.g>

        {thinking ? (
          <motion.circle cx="80" cy="72" r="4" fill="#3ef0d0" animate={animated(reducedMotion, { scale: [0.72, 1, 0.72] }, { scale: 1 })} transition={QUICK_LOOP} />
        ) : (
          <path d="M72 70 Q80 79 88 70" fill="none" stroke="#49f3d5" strokeWidth="4" strokeLinecap="round" />
        )}
      </motion.g>

      <AnimatePresence>
        {tapping && !aimed && (
          <motion.g
            data-part="tap-ripple"
            initial={reducedMotion ? false : { opacity: 0.9, scale: 0.3 }}
            animate={reducedMotion ? { opacity: 0.8, scale: 1 } : { opacity: [0.9, 0], scale: [0.3, 1.7] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.52, repeat: reducedMotion ? 0 : Infinity, ease: 'easeOut' }}
            style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
          >
            <circle cx="158" cy="49" r="7" fill="none" stroke="#4ff4d7" strokeWidth="2.5" />
            <circle cx="158" cy="49" r="2.6" fill="#4ff4d7" />
          </motion.g>
        )}
      </AnimatePresence>
    </svg>
  );
}
