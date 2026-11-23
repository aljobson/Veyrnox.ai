import type { MusicCustomQuoteInput, MusicDraft, MusicEntitlements, MusicInputSnapshot, MusicModel, MusicQuote, MusicSimpleQuoteInput } from './types';
import { MUSIC_BPM_MAX, MUSIC_BPM_MIN, MUSIC_EXCLUDE_STYLES_MAX, parseMusicTempoControls } from './shared';
export type ModelState = 'usable' | 'locked_plan' | 'unavailable';
export type QuoteBlocker = 'empty_prompt' | 'lyrics_required' | 'over_length' | 'bpm_invalid' | 'locked_plan' | 'unavailable' | 'rights' | 'no_slot' | 'not_affordable' | 'quote_expired';
export function modelState(model: MusicModel | undefined, entitlements: MusicEntitlements): ModelState {
    if (!entitlements.available || !model) return 'unavailable';
    if (!model.available) return model.requires_paid_plan ? 'locked_plan' : 'unavailable';
    return 'usable';
}
export const isSunoModel = (model: MusicModel | undefined): boolean => model?.provider_contract === 'crun-suno-v1';
export function modelCounterLimit(model: MusicModel, field: 'prompt' | 'title' | 'lyrics' | 'styles' | 'exclude_styles'): number | null {
    const value = model.counters?.[field]?.max ?? model.limits?.[field];
    return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}
export function clampDuration(value: number, model: MusicModel): number {
    const bounds = model.controls.duration_seconds;
    if (!bounds) return value;
    return Math.max(bounds.min, Math.min(bounds.max, Math.round(Number.isFinite(value) ? value : bounds.default)));
}
const clampPercent = (value: number, fallback: number): number => Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : fallback)));
const clampUnit = (value: number, fallback: number): number => Math.max(0, Math.min(1, Number.isFinite(value) ? value : fallback));
export function bpmInvalid(value: string): boolean {
    if (!value.trim()) return false;
    const bpm = Number(value);
    return !Number.isInteger(bpm) || bpm < MUSIC_BPM_MIN || bpm > MUSIC_BPM_MAX;
}
function tempoValues(input: MusicInputSnapshot) {
    return {
        bpm: input.bpm.trim() ? Number(input.bpm) : null,
        key_scale: input.keyScale || null,
        time_signature: input.timeSignature || null,
    };
}
export function normalizeInput(input: MusicInputSnapshot, model: MusicModel): MusicInputSnapshot {
    return Object.freeze({ ...input, duration: clampDuration(input.duration, model),
        variety: clampPercent(input.variety, 50), styleInfluence: clampPercent(input.styleInfluence, 0),
        weirdness: clampUnit(input.weirdness, 0.5),
        instrumental: (!isSunoModel(model) && input.mode === 'simple') || model.controls.instrumental === 'required' || !model.controls.lyrics || input.instrumental });
}
export function effectiveInput(input: MusicInputSnapshot, model: MusicModel): MusicInputSnapshot {
    const normalized = normalizeInput(input, model), controls = model.controls;
    if (normalized.mode === 'custom' && !isSunoModel(model)) return Object.freeze({ ...normalized,
        variety: 50, styleInfluence: 0, excludeStyles: '', bpm: '', keyScale: '', timeSignature: '' });
    if (isSunoModel(model)) return Object.freeze({ ...normalized, bpm: '', keyScale: '', timeSignature: '',
        ...(normalized.mode === 'simple' ? { title: '', variety: 50, styleInfluence: 0, weirdness: 0.5,
            excludeStyles: '', sunoModel: 'v6' as const, vocalGender: 'auto' as const } : {}) });
    return Object.freeze({ ...normalized,
        variety: controls.variety === true ? normalized.variety : 50,
        styleInfluence: controls.style_influence ? normalized.styleInfluence : 0,
        excludeStyles: controls.exclude_styles ? normalized.excludeStyles.trim() : '',
        bpm: controls.tempo_key_meter && normalized.bpm.trim() ? String(Number(normalized.bpm)) : '',
        keyScale: controls.tempo_key_meter ? normalized.keyScale : '',
        timeSignature: controls.tempo_key_meter ? normalized.timeSignature : '',
    });
}
export function quoteBlockers(o: {
    input: MusicInputSnapshot; entitlements: MusicEntitlements; rights: boolean;
    activeCount?: number; quote?: MusicQuote | null; now?: number; ambiguous?: boolean;
}): QuoteBlocker[] {
    // Recovery replays a submitted key; current form/model limits cannot decide its result.
    if (o.ambiguous) return [];
    const { input, entitlements: e } = o;
    const model = e.models.find(m => m.id === input.model_id);
    const state = modelState(model, e);
    const reasons: QuoteBlocker[] = [];
    if (state !== 'usable') reasons.push(state);
    if (model && !model.generation_modes.includes(input.mode)) reasons.push('unavailable');
    if (input.mode === 'custom' && (!e.custom_drafts.available || !e.custom_drafts.generation_supported)) reasons.push('unavailable');
    if (input.mode === 'simple' && !input.prompt.trim()) reasons.push('empty_prompt');
    if (input.mode === 'simple' && model?.controls.tempo_key_meter && bpmInvalid(input.bpm)) reasons.push('bpm_invalid');
    const suno = !!model && isSunoModel(model);
    const promptMax = model && suno ? modelCounterLimit(model, 'prompt') : 500;
    const titleMax = model && suno ? modelCounterLimit(model, 'title') : Math.min(80, e.custom_drafts.title_max);
    const lyricsMax = model && suno ? modelCounterLimit(model, 'lyrics') : Math.min(3000, e.custom_drafts.lyrics_max);
    const stylesMax = model && suno ? modelCounterLimit(model, 'styles') : Math.min(500, e.custom_drafts.styles_max);
    const excludeMax = model && suno ? modelCounterLimit(model, 'exclude_styles') : MUSIC_EXCLUDE_STYLES_MAX;
    if (((input.mode === 'custom' || !suno) && titleMax !== null && Array.from(input.title).length > titleMax)
        || (input.mode === 'simple' && promptMax !== null && Array.from(input.prompt.trim()).length > promptMax)
        || (input.mode === 'simple' && !!model?.controls.exclude_styles && excludeMax !== null && Array.from(input.excludeStyles).length > excludeMax)
        || (input.mode === 'custom' && ((lyricsMax !== null && Array.from(input.lyrics).length > lyricsMax)
            || (stylesMax !== null && Array.from(input.styles).length > stylesMax)
            || (suno && excludeMax !== null && Array.from(input.excludeStyles).length > excludeMax)))) reasons.push('over_length');
    if (input.mode === 'custom' && suno && !normalizeInput(input, model!).instrumental
        && model?.controls.lyrics_required_for_custom_vocal && !input.lyrics.trim()) reasons.push('lyrics_required');
    if (model && input.mode === 'custom' && !normalizeInput(input, model).instrumental && !o.rights) reasons.push('rights');
    if ((o.activeCount ?? 0) >= e.concurrency_limit) reasons.push('no_slot');
    if (o.quote && !o.quote.affordable) reasons.push('not_affordable');
    if (o.quote && (!Number.isFinite(Date.parse(o.quote.expires_at)) || Date.parse(o.quote.expires_at) <= (o.now ?? Date.now()))) reasons.push('quote_expired');
    return reasons;
}
function checked(input: MusicInputSnapshot, e: MusicEntitlements, rights: boolean): MusicInputSnapshot {
    const blockers = quoteBlockers({ input, entitlements: e, rights });
    if (blockers.length) throw new Error(blockers[0]);
    return effectiveInput(input, e.models.find(m => m.id === input.model_id)!);
}
export function buildSimpleQuote(input: MusicInputSnapshot, e: MusicEntitlements): MusicSimpleQuoteInput {
    if (input.mode !== 'simple') throw new Error('unavailable');
    const v = checked(input, e, false);
    const model = e.models.find(m => m.id === v.model_id)!;
    if (isSunoModel(model)) return { mode: 'simple', provider_contract: 'crun-suno-v1', prompt: v.prompt.trim(),
        instrumental: v.instrumental, model_id: v.model_id, suno_model: 'v6' };
    const tempo = model.controls.tempo_key_meter ? parseMusicTempoControls(tempoValues(v))
        : { ok: true as const, bpm: null, keyScale: null, timeSignature: null, used: false };
    if (!tempo.ok) throw new Error(tempo.error);
    return { mode: 'simple', prompt: v.prompt.trim(), ...(v.title.trim() ? { title: v.title.trim() } : {}), instrumental: true,
        model_id: v.model_id, duration_seconds: v.duration,
        ...(model.controls.variety ? { variety: v.variety } : {}),
        ...(model.controls.style_influence ? { style_influence: v.styleInfluence } : {}),
        ...(model.controls.exclude_styles ? { exclude_styles: v.excludeStyles.trim() || null } : {}),
        ...(model.controls.tempo_key_meter ? { bpm: tempo.bpm, key_scale: tempo.keyScale, time_signature: tempo.timeSignature } : {}),
    };
}
export function buildCustomQuote(input: MusicInputSnapshot, e: MusicEntitlements, draft: number | Pick<MusicDraft, 'id' | 'revision' | 'provider_contract'>, rights: boolean): MusicCustomQuoteInput {
    const revision = typeof draft === 'number' ? draft : draft.revision;
    if (input.mode !== 'custom' || !Number.isInteger(revision) || revision < 0) throw new Error('unavailable');
    const v = checked(input, e, rights);
    const model = e.models.find(m => m.id === v.model_id)!;
    if (isSunoModel(model)) {
        if (typeof draft === 'number' || !draft.id || draft.provider_contract !== 'crun-suno-v1') throw new Error('draft_required');
        return { mode: 'custom', provider_contract: 'crun-suno-v1', draft_id: draft.id, draft_revision: revision,
            instrumental: v.instrumental, rights_confirmed: !v.instrumental, duration_seconds: v.duration,
            suno_model: v.sunoModel, vocal_gender: v.instrumental ? 'auto' : v.vocalGender,
            style_influence: v.styleInfluence, weirdness: v.weirdness, variety: v.variety,
            exclude_styles: v.excludeStyles.trim() };
    }
    return { mode: 'custom', ...(typeof draft !== 'number' && draft.provider_contract && draft.id ? {
        provider_contract: draft.provider_contract, draft_id: draft.id,
    } : {}), draft_revision: revision, instrumental: v.instrumental,
        rights_confirmed: !v.instrumental, duration_seconds: v.duration };
}
