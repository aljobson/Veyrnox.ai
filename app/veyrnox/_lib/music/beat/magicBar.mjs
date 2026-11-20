// Studio Magic Bar (Suno parity S-S3) inside the beat editor. A prompt makes a
// loop that plays with the beat. It reuses the live Create pipeline:
// /music/generation-quotes (ACE-Step 1.5, priced by model_catalog) and
// /music/generations. Nothing is charged until the person presses Confirm.

export { EXAMPLE_PROMPT_KEYS, startExampleRotation } from './beatExamples.mjs';

export const MAGIC_BARS = Object.freeze([4, 8, 16]);
export const MAGIC_PROMPT_MAX = 400;
export const MAGIC_LAYER_LIMIT = 4;
const DURATION = [10, 60];

/** Seconds of `bars` bars of 4/4 at `bpm`. */
export function loopSeconds(bpm, bars) {
  return (bars * 4 * 60) / bpm;
}

/** Bar counts whose loop fits the provider's 10-60 s duration at this tempo. */
export function barChoices(bpm) {
  return MAGIC_BARS.filter((bars) => loopSeconds(bpm, bars) <= DURATION[1] && Math.ceil(loopSeconds(bpm, bars)) >= 1);
}

/** The whole-second duration to request: the loop length rounded up, at least 10 s. */
export function requestSeconds(bpm, bars) {
  return Math.min(DURATION[1], Math.max(DURATION[0], Math.ceil(loopSeconds(bpm, bars))));
}

/** The quote body for one loop. Tempo is sent as a control, not only as words. */
export function magicQuoteBody({ prompt, bpm, bars, title }) {
  const text = String(prompt || '').trim().slice(0, MAGIC_PROMPT_MAX);
  return {
    mode: 'simple',
    model_id: 'ace-step-1.5',
    prompt: `${text}. Instrumental loop, ${bars} bars of 4/4 at ${Math.round(bpm)} BPM, steady groove, clean ending on the bar.`,
    title: String(title || 'Magic loop').trim().slice(0, 80) || 'Magic loop',
    duration_seconds: requestSeconds(bpm, bars),
    bpm: Math.round(bpm),
    time_signature: '4',
  };
}

const LAYER_KEY = (beatId) => `veyrnox.beat.layers.${beatId}`;
const UUID = /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
const JOB_ASSET = /^\/api\/v1\/jobs\/([^/]+)\/asset$/;
const validAudioUrl = (url) => { const match = JOB_ASSET.exec(url || ''); return Boolean(match && UUID.test(match[1])); };
const validLayer = (layer) => layer && UUID.test(layer.songId || '') && validAudioUrl(layer.audioUrl)
  && typeof layer.title === 'string' && MAGIC_BARS.includes(layer.bars) && Number.isFinite(layer.bpm) && typeof layer.muted === 'boolean';

/**
 * Loop layers live beside the beat document, not inside it, so the version 1
 * document stays as the beat editor defines it. Phase 3 (audio regions) can
 * move them into the document. Storage can be unavailable; then layers last for
 * this visit only.
 */
export function readLayers(beatId, storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage?.getItem(LAYER_KEY(beatId)) || '[]');
    return Array.isArray(parsed) ? parsed.filter(validLayer).slice(0, MAGIC_LAYER_LIMIT) : [];
  } catch { return []; }
}

export function writeLayers(beatId, layers, storage = globalThis.localStorage) {
  try { storage?.setItem(LAYER_KEY(beatId), JSON.stringify(layers.filter(validLayer).slice(0, MAGIC_LAYER_LIMIT))); return true; }
  catch { return false; }
}
