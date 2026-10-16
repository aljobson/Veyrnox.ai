import { outputDurationLabel } from './chatMedia.js';
import { kindOf } from './tokens.js';

export const creditLabel = (credits) => `${credits} ${credits === 1 ? 'credit' : 'credits'}`;
export const generationCostLabel = (credits) => credits === 0 ? 'Free' : `−${credits} cr`;

export function sourceDurationLimit(model) {
  const presentation = model?.presentation || model?.capabilities?.presentation || {};
  if (presentation.fixedDurationLabel || Object.keys(presentation.durationByOption || {}).length) return null;
  const media = model?.media || model?.capabilities?.media || {};
  const slot = [media.audio, media.video].find((spec) => spec?.required && Number.isFinite(spec.maxSeconds));
  return slot?.maxSeconds || null;
}

export function audioDurationLabel(model) {
  const duration = model?.durationInput || model?.capabilities?.inputs?.duration;
  if (Number.isFinite(duration?.min) && Number.isFinite(duration?.max)) {
    const defaultLabel = Number.isFinite(duration.default) ? ` (${duration.default} s default)` : '';
    return `${duration.min}–${duration.max} s${defaultLabel}`;
  }
  const fixed = outputDurationLabel(model);
  return fixed ? fixed.replace(/s$/i, ' s') : null;
}

/** The base catalog credit price buys this output; internal billing units never masquerade as clip lengths. */
export function modelPriceUnit(model) {
  const kind = model?.kind || kindOf(model?.modality);
  if (kind === 'image') return 'per image.';
  if (kind === 'video') {
    const sourceLimit = sourceDurationLimit(model);
    if (sourceLimit) return `per generation (source up to ${sourceLimit} s).`;
    const durations = model?.durations?.length ? model.durations : [5];
    const base = outputDurationLabel({ ...model, kind }, durations[0]).replace(/s$/i, ' s');
    const longer = durations.includes(10) && durations[0] === 5 ? '; 10 s costs double' : '';
    return `per ${base} clip${longer}.`;
  }
  const stems = model?.outputStems || model?.capabilities?.outputStems;
  const sourceLimit = sourceDurationLimit(model);
  if (Array.isArray(stems) && sourceLimit) return `per separation (source up to ${sourceLimit} s).`;
  const control = model?.durationInput || model?.capabilities?.inputs?.duration;
  if (Number.isFinite(control?.min) && Number.isFinite(control?.max)) {
    const defaultLabel = Number.isFinite(control.default) ? ` (${control.default} s default)` : '';
    return `per ${control.min}–${control.max} s track${defaultLabel}.`;
  }
  const duration = audioDurationLabel(model);
  if (duration) return `per ${duration} clip.`;
  if (model?.isSpeech || model?.capabilities?.kind === 'speech') {
    const max = model?.promptMax || model?.capabilities?.inputs?.prompt?.max;
    return Number.isFinite(max) ? `per generation (up to ${max} characters).` : 'per speech generation.';
  }
  return 'per clip.';
}
