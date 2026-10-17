import { outputDurationLabel } from './chatMedia.js';
import { kindOf } from './tokens.js';
import { translator } from '../../../lib/i18n/translate.mjs';

const ENGLISH = translator('en');

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
// `t` is a translator (lib/i18n/translate.mjs); with none the unit reads in English.
export function modelPriceUnit(model, t = ENGLISH) {
  const kind = model?.kind || kindOf(model?.modality);
  if (kind === 'image') return t('unit.image');
  if (kind === 'video') {
    const sourceLimit = sourceDurationLimit(model);
    if (sourceLimit) return t('unit.videoSource', { n: sourceLimit });
    const durations = model?.durations?.length ? model.durations : [5];
    const base = outputDurationLabel({ ...model, kind }, durations[0]).replace(/s$/i, ' s');
    const doubles = durations.includes(10) && durations[0] === 5;
    return t(doubles ? 'unit.videoClipDouble' : 'unit.videoClip', { base });
  }
  const stems = model?.outputStems || model?.capabilities?.outputStems;
  const sourceLimit = sourceDurationLimit(model);
  if (Array.isArray(stems) && sourceLimit) return t('unit.separation', { n: sourceLimit });
  const control = model?.durationInput || model?.capabilities?.inputs?.duration;
  if (Number.isFinite(control?.min) && Number.isFinite(control?.max)) {
    return Number.isFinite(control.default)
      ? t('unit.trackDefault', { min: control.min, max: control.max, d: control.default })
      : t('unit.track', { min: control.min, max: control.max });
  }
  const duration = audioDurationLabel(model);
  if (duration) return t('unit.clipDuration', { duration });
  if (model?.isSpeech || model?.capabilities?.kind === 'speech') {
    const max = model?.promptMax || model?.capabilities?.inputs?.prompt?.max;
    return Number.isFinite(max) ? t('unit.speechMax', { n: max }) : t('unit.speech');
  }
  return t('unit.clip');
}
