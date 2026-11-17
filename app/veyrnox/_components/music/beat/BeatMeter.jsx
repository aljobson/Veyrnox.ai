'use client';
import { useI18n } from '../../../../../components/I18nProvider';

import { useEffect, useState } from 'react';
// One animation loop for all mounted meters. No analysers exist while Mixer is closed.
const readers = new Set(); let frame = null, previous = -Infinity;
function animate(time) {
  if (time - previous >= 1000 / 30) { previous = time; readers.forEach(read => read(time)); }
  frame = readers.size ? requestAnimationFrame(animate) : null;
}
export default function BeatMeter({ engine, trackId, name }) {
  const { t } = useI18n();
  const [peak, setPeak] = useState(-60), [focused, setFocused] = useState(false), [reduced, setReduced] = useState(false);
  useEffect(() => {
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const preference = () => setReduced(motion.matches); preference(); motion.addEventListener('change', preference);
    let tap, analyser, samples, lastText = -Infinity;
    function detach() { if (tap && analyser) { try { tap.disconnect(analyser); } catch {} analyser.disconnect(); } }
    function read(time) {
      const current = engine.current, next = current?.meterTap(trackId);
      if (next !== tap) {
        detach(); tap = next; analyser = null;
        if (tap && current.context.createAnalyser) { analyser = current.context.createAnalyser(); analyser.fftSize = 256; samples = new Float32Array(256); tap.connect(analyser); }
      }
      if (motion.matches && time - lastText < 250) return;
      lastText = time;
      if (!analyser) { setPeak(-60); return; }
      analyser.getFloatTimeDomainData(samples);
      let amplitude = 0; for (const sample of samples) amplitude = Math.max(amplitude, Math.abs(sample));
      setPeak(Math.round(Math.max(-60, Math.min(0, 20 * Math.log10(amplitude || 0.001)))));
    }
    readers.add(read); if (frame === null) frame = requestAnimationFrame(animate);
    return () => { readers.delete(read); detach(); motion.removeEventListener('change', preference); if (!readers.size && frame !== null) { cancelAnimationFrame(frame); frame = null; } };
  }, [engine, trackId]);
  return <div role="meter" tabIndex={0} aria-label={t('app.music.beat.labels.l26', { p0: name })} aria-valuemin={-60} aria-valuemax={0}
    aria-valuenow={focused ? peak : undefined} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    className="min-h-11 rounded border border-vx-border p-2 text-xs focus-visible:outline-vx-accent">
    {!reduced && <div aria-hidden="true" className="h-2 bg-vx-base"><div className="h-2 bg-vx-accent" style={{ width: `${(peak + 60) / 60 * 100}%` }} /></div>}
    <span aria-hidden="true">{peak <= -60 ? '−∞' : peak}{t('app.music.beat.ui.dbfs')}</span>
  </div>;
}
