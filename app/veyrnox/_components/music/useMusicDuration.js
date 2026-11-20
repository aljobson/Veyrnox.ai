import { useEffect, useState } from 'react';
import { reconcileMusicDuration } from '../../_lib/music/durationPrice.js';

/**
 * Duration state kept inside the model's current bounds. The clamped value is returned during render, so the
 * slider, the visible output and any submitted request always agree. When the bounds force a change, the stored
 * value follows and, only for the active form, the shared quote is cleared (an inactive form must not wipe the
 * other form's quote).
 */
export function useMusicDuration(bounds, clearQuote, { active = true } = {}) {
  const [durationSeconds, setDurationSeconds] = useState(60);
  const { min = 10, max = 60 } = bounds || {};
  const effective = reconcileMusicDuration(durationSeconds, { min, max });

  useEffect(() => {
    if (effective === durationSeconds) return;
    setDurationSeconds(effective);
    if (active) clearQuote();
  }, [effective, durationSeconds, active, clearQuote]);

  return [effective, setDurationSeconds];
}
