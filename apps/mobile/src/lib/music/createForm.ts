import type { MusicCustomQuoteInput, MusicEntitlements, MusicInputSnapshot, MusicModel, MusicQuote, MusicSimpleQuoteInput } from './types';
export type ModelState = 'usable' | 'locked_plan' | 'unavailable';
export type QuoteBlocker = 'empty_prompt' | 'over_length' | 'locked_plan' | 'unavailable' | 'rights' | 'no_slot' | 'not_affordable' | 'quote_expired';
export function modelState(model: MusicModel | undefined, entitlements: MusicEntitlements): ModelState {
    if (!entitlements.available || !model) return 'unavailable';
    if (!model.available) return model.requires_paid_plan ? 'locked_plan' : 'unavailable';
    return 'usable';
}
export function clampDuration(value: number, model: MusicModel): number {
    const bounds = model.controls.duration_seconds;
    return Math.max(10, bounds.min, Math.min(60, bounds.max, Math.round(Number.isFinite(value) ? value : bounds.default)));
}
export function normalizeInput(input: MusicInputSnapshot, model: MusicModel): MusicInputSnapshot {
    return Object.freeze({ ...input, duration: clampDuration(input.duration, model),
        instrumental: input.mode === 'simple' || model.controls.instrumental === 'required' || !model.controls.lyrics || input.instrumental });
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
    if (input.title.length > Math.min(80, e.custom_drafts.title_max)
        || (input.mode === 'simple' && input.prompt.trim().length > 500)
        || (input.mode === 'custom' && (input.lyrics.length > Math.min(3000, e.custom_drafts.lyrics_max)
            || input.styles.length > Math.min(500, e.custom_drafts.styles_max)))) reasons.push('over_length');
    if (model && !normalizeInput(input, model).instrumental && !o.rights) reasons.push('rights');
    if ((o.activeCount ?? 0) >= e.concurrency_limit) reasons.push('no_slot');
    if (o.quote && !o.quote.affordable) reasons.push('not_affordable');
    if (o.quote && (!Number.isFinite(Date.parse(o.quote.expires_at)) || Date.parse(o.quote.expires_at) <= (o.now ?? Date.now()))) reasons.push('quote_expired');
    return reasons;
}
function checked(input: MusicInputSnapshot, e: MusicEntitlements, rights: boolean): MusicInputSnapshot {
    const blockers = quoteBlockers({ input, entitlements: e, rights });
    if (blockers.length) throw new Error(blockers[0]);
    return normalizeInput(input, e.models.find(m => m.id === input.model_id)!);
}
export function buildSimpleQuote(input: MusicInputSnapshot, e: MusicEntitlements): MusicSimpleQuoteInput {
    if (input.mode !== 'simple') throw new Error('unavailable');
    const v = checked(input, e, false);
    return { mode: 'simple', prompt: v.prompt.trim(), ...(v.title.trim() ? { title: v.title.trim() } : {}), instrumental: true,
        model_id: v.model_id, duration_seconds: v.duration };
}
export function buildCustomQuote(input: MusicInputSnapshot, e: MusicEntitlements, revision: number, rights: boolean): MusicCustomQuoteInput {
    if (input.mode !== 'custom' || !Number.isInteger(revision) || revision < 0) throw new Error('unavailable');
    const v = checked(input, e, rights);
    return { mode: 'custom', draft_revision: revision, instrumental: v.instrumental,
        rights_confirmed: !v.instrumental, duration_seconds: v.duration };
}
