import { envelopeGain, tickSeconds } from './beatAudioSegments.mjs';
const clamp = (v) => Math.max(0, Math.min(1, v));
export function playAudioSegment(context, destination, buffer, segment, region, tempo, when) {
  const source = context.createBufferSource(); source.buffer = buffer;
  const gain = context.createGain(), fadeIn = context.createGain(), fadeOut = context.createGain();
  source.connect(gain).connect(fadeIn).connect(fadeOut).connect(destination);
  const t = segment.regionTimeSec, duration = segment.durationSec;
  const length = tickSeconds(region.length, tempo);
  // Separate linear ramps multiply exactly, even when anchored fragments overlap.
  gain.gain.setValueAtTime(10 ** (region.gainDb / 20), when);
  function ramp(node, from, to, falling) {
    const value = (at) => falling ? 1 - clamp((at - from) / (to - from)) : clamp((at - from) / (to - from));
    node.gain.setValueAtTime(value(t), when);
    for (const at of [from, to, t + duration]) {
      if (at > t && at <= t + duration) node.gain.linearRampToValueAtTime(value(at), when + at - t);
    }
  }
  if (region.fadeIn) ramp(fadeIn, region.fadeIn.startSec, region.fadeIn.endSec, false);
  if (region.fadeOut) ramp(fadeOut, length - region.fadeOut.startBeforeEndSec, length - region.fadeOut.endBeforeEndSec, true);
  // A reversed buffer is sampled at the same phase; slicing must never remap it.
  source.start(when, segment.offsetSec, duration);
  source.onended = () => { source.disconnect(); gain.disconnect(); fadeIn.disconnect(); fadeOut.disconnect(); };
  return { source, gainAtStart: envelopeGain(region, t, tempo) };
}
