'use client';
import { motion, useReducedMotion } from 'motion/react';

// Vey peeking over the top edge of the pack or plan the reader chose: head and paws show, the chin stays behind the card.
// Render it inside the chosen card (which must be `relative`); it appears only while that card is chosen, so nothing
// else on the paywall moves. It is decoration: the card and its words carry the meaning, so it is hidden from assistive
// technology and takes no clicks, and it holds still for anyone who asked for less motion.
export function VeyCardPeek() {
  const reduceMotion = useReducedMotion();
  // The wrapper crops only the bottom edge, so Vey rises from behind the card without showing over it.
  return (
    <motion.div
      aria-hidden="true"
      data-testid="paywall-vey"
      className="pointer-events-none absolute bottom-full start-1/2 -mb-px w-[96px] -translate-x-1/2 rtl:translate-x-1/2 sm:w-[112px]"
      style={{ clipPath: 'inset(-100% -50% 0 -50%)' }}
      initial={reduceMotion ? false : { y: 48 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.38, ease: 'easeOut' }}
    >
      <svg viewBox="20 6 120 73" className="block h-auto w-full overflow-visible" focusable="false">
        <path d="M28 28 C34 10 55 9 80 31 C105 9 126 10 132 28 C139 53 121 86 81 96 C40 86 21 53 28 28Z" fill="#dbe8ea" stroke="#83a6aa" strokeWidth="2.5" />
        <path d="M36 30 C42 18 56 18 80 40 C104 18 118 18 124 30 C131 50 114 77 80 85 C46 77 29 50 36 30Z" fill="#0a1115" stroke="#1ee6c2" strokeWidth="2" />
        <path d="M39 25 C48 14 61 21 79 38" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" opacity="0.6" />
        <ellipse cx="59" cy="55" rx="10" ry="15" fill="#38f0d0" />
        <ellipse cx="101" cy="55" rx="10" ry="15" fill="#38f0d0" />
        <ellipse cx="60" cy="57" rx="6" ry="10" fill="#102328" />
        <ellipse cx="100" cy="57" rx="6" ry="10" fill="#102328" />
        <circle cx="63" cy="52" r="2.7" fill="#ffffff" />
        <circle cx="103" cy="52" r="2.7" fill="#ffffff" />
        <path d="M72 70 Q80 79 88 70" fill="none" stroke="#49f3d5" strokeWidth="4" strokeLinecap="round" />
        <ellipse cx="49" cy="79" rx="13" ry="9" fill="#dbe8ea" stroke="#789b9f" strokeWidth="2" />
        <ellipse cx="111" cy="79" rx="13" ry="9" fill="#dbe8ea" stroke="#789b9f" strokeWidth="2" />
        <path d="M38 79 Q49 84 60 79 M100 79 Q111 84 122 79" fill="none" stroke="#1ee6c2" strokeWidth="2.5" />
      </svg>
    </motion.div>
  );
}
