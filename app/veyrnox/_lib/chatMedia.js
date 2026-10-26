import { sourceList, publicSlotMax, generationSourceState } from '../../../lib/generationSourceSlots.mjs';
import { helperEnglish, helperDiagnostic } from '../../../lib/helperMessages.mjs';
export const COMPOSER_KINDS = Object.freeze({
  CHAT: 'chat',
  IMAGE: 'image',
  VIDEO: 'video',
  AUDIO: 'audio',
});

export const MEDIA_KINDS = Object.freeze([
  COMPOSER_KINDS.IMAGE,
  COMPOSER_KINDS.VIDEO,
  COMPOSER_KINDS.AUDIO,
]);

/** Models the compact Chat composer can buy directly. Editors, agents and Auto Short keep their own flows. */
export function chatMediaModels(models, kind) {
  if (!MEDIA_KINDS.includes(kind)) return [];
  return (Array.isArray(models) ? models : []).filter((model) => (
    model?.kind === kind && !model.isEdit && !model.takesPlan && !model.takesTopic
  ));
}

export function firstOpenMediaModel(models, kind) {
  const available = chatMediaModels(models, kind);
  const open = available.filter((model) => !model.gated);
  return open.find((model) => model.takesPrompt !== false && !Object.values(model.media || {}).some((slot) => slot.required))
    || open[0] || available[0] || null;
}

export function mediaPromptIsMissing(model, prompt) {
  return model?.takesPrompt !== false && !String(prompt || '').trim();
}

/** Preserve model-declared roles when mixing uploaded files and owned Library assets. */
export async function mediaGenerationSources(model, sources, uploadSource) {
  if (generationSourceState(model?.media, sources).needsReattach) throw Object.assign(new Error('source_reattach_required'), { code: 'source_reattach_required' });
  const references = [], source_keys = [], source_assets = [];
  for (const [slot, value] of Object.entries(sources || {})) {
    const spec = model?.media?.[slot];
    if (!spec) continue;
    const files = sourceList(value);
    if (files.length > publicSlotMax(spec)) throw Object.assign(new Error('source_count_exceeded'), { code: 'source_count_exceeded' });
    for (const source of files) {
      if (source.assetId) {
        references.push({ slot, origin: 'asset', asset_id: source.assetId });
        source_assets.push({ slot, asset_id: source.assetId });
      } else if (source.sourceKey || source.file) {
        const key = source.sourceKey || await uploadSource(source.file);
        references.push({ slot, origin: 'upload', key }); source_keys.push({ slot, key });
      } else throw Object.assign(new Error('source_reattach_required'), { code: 'source_reattach_required' });
    }
  }
  return { references, source_keys, source_assets };
}

export function supportedDuration(model, wanted) {
  const durations = Array.isArray(model?.durations) && model.durations.length ? model.durations : [5];
  return durations.includes(wanted) ? wanted : durations[0];
}

export function supportedAspect(model, wanted) {
  const aspects = Array.isArray(model?.aspects) ? model.aspects : [];
  if (!aspects.length) return null;
  return aspects.includes(wanted) ? wanted : aspects[0];
}

export function mediaGenerationCount(model, wanted) {
  return model?.kind === COMPOSER_KINDS.IMAGE && [1, 2, 3, 4].includes(wanted) ? wanted : 1;
}

export function mediaGenerationCredits(model, duration, count) {
  if (!model || !Number.isFinite(model.credits)) return 0;
  const units = model.kind === COMPOSER_KINDS.VIDEO ? Math.ceil(supportedDuration(model, duration) / 5) : 1;
  return model.credits * units * mediaGenerationCount(model, count);
}

export function outputDurationLabel(model, selectedDuration) {
  const presentation = model?.presentation || model?.capabilities?.presentation || {};
  const mapped = presentation.durationByOption?.[String(selectedDuration)];
  if (mapped !== undefined && mapped !== null && String(mapped).trim()) return `${String(mapped).replace(/s$/i, '')}s`;
  if (presentation.fixedDurationLabel) return presentation.fixedDurationLabel;
  return model?.kind === COMPOSER_KINDS.VIDEO ? `${supportedDuration(model, selectedDuration)}s` : null;
}

export function videoAudioLabel(model, selectedAudio) {
  const included = typeof selectedAudio === 'boolean' ? selectedAudio : model?.presentation?.audioIncluded;
  if (included === true) return helperEnglish('audio_on');
  if (included === false) return helperEnglish('audio_off');
  return helperEnglish('audio_model_default');
}

export function resolutionLabel(model, selectedResolution) {
  return selectedResolution || model?.presentation?.resolutionLabel || 'Model resolution';
}

/** Only emit controls declared by this model; switching models cannot carry a stale tier to the server. */
export function mediaOutputSettings(model, resolution, audio) {
  const settings = {};
  const resolutions = model?.resolutions || [];
  const audioOptions = model?.audioOptions || [];
  if (resolutions.length) settings.output_resolution = resolutions.includes(resolution) ? resolution
    : resolutions.includes(model.presentation?.resolutionLabel) ? model.presentation.resolutionLabel : resolutions[0];
  if (audioOptions.length) settings.audio_enabled = audioOptions.includes(audio) ? audio
    : audioOptions.includes(model.presentation?.audioIncluded) ? model.presentation.audioIncluded : audioOptions[0];
  return settings;
}

/** Locale-neutral display diagnostic; the legacy string interface remains available. */
export const videoAudioLabelDiagnostic = (...args) => helperDiagnostic(videoAudioLabel(...args));
