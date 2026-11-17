import messages from '../../../../../lib/i18n/messages/app/en/music-beat-time.mjs';
import { translator, pluralKey } from '../../../../../lib/i18n/translate.mjs';
const english = translator('en', messages);
export const PPQ = 960;
export const stepTicks = 240;
export const stepSeconds = (bpm) => 60 / bpm / 4;
export const stepTime = (stepIndex, bpm, swing) => (stepIndex + (stepIndex % 2 ? swing * 0.5 : 0)) * stepSeconds(bpm);
export const loopSeconds = (bpm, steps) => stepSeconds(bpm) * steps;
export function nearestStep(offset, bpm, swing, steps) {
  const length = loopSeconds(bpm, steps);
  const wrapped = ((offset % length) + length) % length;
  let best = 0;
  let distance = Infinity;
  for (let step = 0; step < steps; step++) {
    const delta = Math.abs(wrapped - stepTime(step, bpm, swing));
    const circular = Math.min(delta, length - delta);
    if (circular < distance) { best = step; distance = circular; }
  }
  return best;
}

export const barTicks = 3840;
export const snapTick = (tick, snap = stepTicks) => Math.round(tick / snap) * snap;
export const clampLocator = (tick, end) => Math.max(0, Math.min(end, snapTick(tick)));
export function moveLocator(tick, key, snap, end) {
  const delta = { ArrowLeft: -snap, ArrowRight: snap, PageUp: -barTicks, PageDown: barTicks }[key];
  return clampLocator(key === 'Home' ? 0 : key === 'End' ? end : tick + (delta || 0), end);
}
// Shared by the scheduler and mixdown; straight boundaries never accumulate swing.
export const swingDelay = (step, bpm, swing) => step % 2 ? swing * stepSeconds(bpm) * 0.5 : 0;
export const eventTime = (straight, step, bpm, swing) => straight + swingDelay(step, bpm, swing);

export function formatPosition(ticks, t = english) {
  const tick = Math.max(0, Math.floor(ticks));
  const bar = Math.floor(tick / 3840) + 1, beat = Math.floor(tick % 3840 / 960) + 1;
  const step = Math.floor(tick % 960 / 240) + 1;
  return t('app.music.beat.time.position.bar', { n: bar }) + (tick % 3840 ? t('app.music.beat.time.position.beat', { n: beat }) : '') + (tick % 960 ? t('app.music.beat.time.position.step', { n: step }) : '');
}
// Durations are rounded to the nearest 1/64 note, never decimal beats.
export function formatNoteLength(ticks, t = english, locale = 'en') {
  const units = Math.max(1, Math.round(ticks / 60));
  const bars = Math.floor(units / 64), beats = Math.floor(units % 64 / 16), fraction = units % 16;
  const parts = [];
  if (bars) parts.push(t(pluralKey(t, locale, 'app.music.beat.time.bars', bars), { n: bars }));
  if (beats) parts.push(t(pluralKey(t, locale, 'app.music.beat.time.beats', beats), { n: beats }));
  if (fraction) {
    let numerator = fraction, denominator = 64;
    while (numerator % 2 === 0) { numerator /= 2; denominator /= 2; }
    parts.push(`${numerator}/${denominator}`);
  }
  return parts.join(' ');
}
