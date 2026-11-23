'use client';
import { useReducedMotion } from 'motion/react';
import { veyMoodFor } from '../../../lib/veyMood';
import VeyCharacter from './VeyCharacter';

// Vey's face for a moment that happens on the page (lib/veyMood.js situations), drawn inline where it happens:
// beside a failure, a refusal or an empty-credits message. It is part of the layout, so it never floats over
// content or takes a tap, and it is decorative: the message next to it says everything. `fallback` shows when the
// situation has no mood (a local form mistake is not Vey's to react to).
export default function VeyMoment({ situation, fallback = null, size = 44 }) {
  const reduced = useReducedMotion();
  const mood = veyMoodFor(situation);
  if (!mood) return fallback;
  return (
    <span aria-hidden="true" data-vey-moment={situation} className="inline-block shrink-0 [&>svg]:drop-shadow-none" style={{ width: size }}>
      <VeyCharacter pose="idle" mood={mood} reducedMotion={reduced !== false} />
    </span>
  );
}
