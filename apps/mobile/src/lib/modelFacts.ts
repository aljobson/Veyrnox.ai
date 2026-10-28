import { t } from './i18n';
import { kindOf, type CatalogModel } from './media';

type Input = { type?: string; values?: unknown[]; min?: number; max?: number; default?: number };
const inputsOf = (model: CatalogModel) => (model.capabilities?.inputs ?? {}) as Record<string, Input>;
const humanise = (key: string) => key.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
const MODES: Record<string, string> = {
    'text-to-image': 'modelPage.mode.textToImage',
    'text-to-video': 'modelPage.mode.textToVideo',
    'image-to-video': 'modelPage.mode.imageToVideo',
    'text-to-audio': 'modelPage.mode.textToAudio',
    'image-to-image': 'modelPage.mode.imageToImage',
    'video-to-video': 'modelPage.mode.videoToVideo',
    'audio-to-audio': 'modelPage.mode.audioToAudio',
};
const MEDIA: Record<string, string> = { image: 'model.media.image', video: 'model.media.video', audio: 'model.media.audio' };

export function sourceDurationLimit(model: CatalogModel): number | null {
    const presentation = model.capabilities?.presentation;
    if (presentation?.fixedDurationLabel || Object.keys(presentation?.durationByOption ?? {}).length) return null;
    const media = model.capabilities?.media;
    const slot = [media?.audio, media?.video].find(spec => spec?.required && Number.isFinite(spec.maxSeconds));
    return slot?.maxSeconds || null;
}

export function outputDurationLabel(model: CatalogModel, seconds?: number): string | null {
    const presentation = model.capabilities?.presentation;
    const mapped = presentation?.durationByOption?.[String(seconds)];
    if (mapped != null && String(mapped).trim()) return `${String(mapped).replace(/s$/i, '')}s`;
    if (presentation?.fixedDurationLabel) return presentation.fixedDurationLabel;
    const durations = model.durations.length ? model.durations : [5];
    return kindOf(model.modality) === 'video' ? `${seconds !== undefined && durations.includes(seconds) ? seconds : durations[0]}s` : null;
}

function audioDurationLabel(model: CatalogModel): string | null {
    const duration = inputsOf(model).duration;
    if (Number.isFinite(duration?.min) && Number.isFinite(duration?.max)) {
        return t(Number.isFinite(duration.default) ? 'modelPage.audioRangeDefault' : 'modelPage.audioRange', {
            min: duration.min!, max: duration.max!, d: duration.default ?? '',
        });
    }
    return outputDurationLabel(model)?.replace(/s$/i, ' s') ?? null;
}

// Catalog labels describe what the base price buys; these helpers never calculate credits.
export function priceUnit(model: CatalogModel): string {
    const kind = kindOf(model.modality);
    if (kind === 'image') return t('modelPage.unit.image');
    const sourceLimit = sourceDurationLimit(model);
    if (kind === 'video') {
        if (sourceLimit) return t('modelPage.unit.videoSource', { n: sourceLimit });
        const durations = model.durations.length ? model.durations : [5];
        const base = outputDurationLabel(model, durations[0])!.replace(/s$/i, ' s');
        return t(durations.includes(10) && durations[0] === 5 ? 'modelPage.unit.videoClipDouble' : 'modelPage.unit.videoClip', { base });
    }
    if (Array.isArray(model.capabilities?.outputStems) && sourceLimit) return t('modelPage.unit.separation', { n: sourceLimit });
    const control = inputsOf(model).duration;
    if (Number.isFinite(control?.min) && Number.isFinite(control?.max)) {
        return t(Number.isFinite(control.default) ? 'modelPage.unit.trackDefault' : 'modelPage.unit.track', {
            min: control.min!, max: control.max!, d: control.default ?? '',
        });
    }
    const duration = audioDurationLabel(model);
    if (duration) return t('modelPage.unit.clipDuration', { duration });
    if (model.capabilities?.kind === 'speech') {
        const max = inputsOf(model).prompt?.max;
        return Number.isFinite(max) ? t('modelPage.unit.speechMax', { n: max! }) : t('modelPage.unit.speech');
    }
    return t('modelPage.unit.clip');
}

export function modelFacts(model: CatalogModel): { label: string; value: string }[] {
    const caps = model.capabilities;
    const inputs = inputsOf(model);
    const mode = Object.hasOwn(MODES, model.modality) ? MODES[model.modality] : undefined;
    const facts = [{ label: t('modelPage.fact.mode'), value: mode ? t(mode) : model.modality.replace(/-/g, ' ') }];
    const kind = kindOf(model.modality);
    if (kind === 'video' && model.durations.length) {
        const limit = sourceDurationLimit(model);
        facts.push({ label: t('modelPage.fact.clipLengths'), value: limit ? t('modelPage.fact.followsSource', { n: limit })
            : model.durations.map(s => outputDurationLabel(model, s)!.replace(/s$/i, ' s')).join(', ') });
    }
    if (kind === 'audio') {
        const duration = audioDurationLabel(model);
        if (duration || caps?.kind === 'speech') facts.push({ label: t('modelPage.fact.outputDuration'), value: duration ?? t('modelPage.fact.dependsOnText') });
    }
    if (Array.isArray(caps?.outputStems)) facts.push({ label: t('modelPage.fact.stems'), value: caps.outputStems.join(', ') });
    if (inputs.prompt) facts.push({ label: t('modelPage.fact.prompt'), value: t('modelPage.fact.textPrompt') });
    for (const [slot, spec] of Object.entries(caps?.media ?? {})) {
        const state = t(spec.required ? 'modelPage.fact.required' : 'modelPage.fact.optional');
        const media = Object.hasOwn(MEDIA, slot) ? t(MEDIA[slot]) : humanise(slot);
        facts.push({ label: t('modelPage.fact.input', { media }), value: spec.maxSeconds ? t('modelPage.fact.upTo', { state, n: spec.maxSeconds }) : state });
    }
    for (const [key, rule] of Object.entries(inputs)) {
        if (rule.type === 'enum' && Array.isArray(rule.values) && rule.values.length) {
            facts.push({ label: key === 'aspect_ratio' ? t('modelPage.field.aspectRatio') : humanise(key), value: rule.values.join(', ') });
        }
    }
    return facts;
}
