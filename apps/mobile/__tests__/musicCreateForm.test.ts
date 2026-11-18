import { buildCustomQuote, buildSimpleQuote, clampDuration, modelState, quoteBlockers } from '../src/lib/music/createForm';
import { isMusicDraft, isMusicGenerationView, isMusicCandidateView } from '../src/lib/music/validate';
import { getCustomDraft, saveCustomDraft, getGeneration, conflictDraft } from '../src/lib/music/client';
import { ApiError, type ApiClient } from '../src/lib/api';
import { entitlements as e, input, custom, draft, view, quote } from './fixtures/musicCreate';
// @ts-ignore server parser proves exact request acceptance
import { parseMusicQuote } from '../../../lib/musicBackend.js';
for (const [name, validate, fixture] of [
    ['draft', isMusicDraft, draft], ['generation', isMusicGenerationView, view], ['candidate', isMusicCandidateView, view.candidates[0]],
] as const) {
    test(`${name} accepts the complete wire fixture`, () => expect(validate(fixture)).toBe(true));
    test.each(Object.keys(fixture))(`${name} rejects missing or mistyped %s`, key => {
        const value = { ...fixture } as Record<string, unknown>; delete value[key]; expect(validate(value)).toBe(false);
        expect(validate({ ...fixture, [key]: false })).toBe(false);
    });
}
test.each(Object.keys(view.candidates[0]))('generation validates nested candidate %s', key => {
    const candidate = { ...view.candidates[0] } as Record<string, unknown>; delete candidate[key];
    expect(isMusicGenerationView({ ...view, candidates: [candidate] })).toBe(false);
    expect(isMusicGenerationView({ ...view, candidates: [{ ...view.candidates[0], [key]: false }] })).toBe(false);
});
test('client draft and generation paths, exact save keys, conflict helper', async () => {
    const request = jest.fn().mockResolvedValue({ draft }); const api = { request } as unknown as ApiClient;
    expect(await getCustomDraft(api)).toEqual(draft); await saveCustomDraft(api, draft);
    expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({ revision: 0, model_id: draft.model_id, lyrics: '', styles: '', title: '' });
    request.mockResolvedValue(view); expect(await getGeneration(api, view.id)).toEqual(view);
    expect(request.mock.calls[2][0]).toBe(`/api/v1/music/generations/${view.id}`);
    expect(conflictDraft(new ApiError(409, 'revision_conflict', { draft }))).toEqual(draft);
    expect(conflictDraft(new ApiError(409, 'revision_conflict', { draft: { revision: 1 } }))).toBeNull();
});
test('exact quote key sets and parser acceptance', () => {
    const simple = buildSimpleQuote(input, e), other = buildCustomQuote(custom, e, 2, true);
    expect(Object.keys(simple).sort()).toEqual(['mode', 'prompt', 'title', 'instrumental', 'model_id', 'duration_seconds'].sort());
    expect(Object.keys(other).sort()).toEqual(['mode', 'draft_revision', 'instrumental', 'rights_confirmed', 'duration_seconds'].sort());
    expect(parseMusicQuote(simple).ok).toBe(true); expect(parseMusicQuote(other).ok).toBe(true);
    expect(buildSimpleQuote({ ...input, title: '  ' }, e)).not.toHaveProperty('title');
});
test('rights invariant and forced instrumental', () => {
    expect(() => buildCustomQuote(custom, e, 2, false)).toThrow('rights');
    expect(buildCustomQuote({ ...custom, instrumental: true }, e, 2, true).rights_confirmed).toBe(false);
    const required = { ...e, models: [{ ...e.models[1], controls: { ...e.models[1].controls, instrumental: 'required' as const } }] };
    expect(buildCustomQuote(custom, required, 2, false)).toMatchObject({ instrumental: true, rights_confirmed: false });
    const noLyrics = { ...e, models: [{ ...e.models[1], controls: { ...e.models[1].controls, lyrics: false } }] };
    expect(buildCustomQuote(custom, noLyrics, 2, false).instrumental).toBe(true);
    expect(buildSimpleQuote({ ...input, instrumental: false }, e).instrumental).toBe(true);
});
test('clamps model durations and validates lengths', () => {
    expect(clampDuration(0, e.models[0])).toBe(10); expect(clampDuration(100, e.models[0])).toBe(60);
    expect(clampDuration(52, { ...e.models[0], controls: { ...e.models[0].controls, duration_seconds: { min: 20, max: 40, default: 30 } } })).toBe(40);
    for (const patch of [{ prompt: 'x'.repeat(501) }, { title: 'x'.repeat(81) }]) expect(() => buildSimpleQuote({ ...input, ...patch }, e)).toThrow('over_length');
    for (const patch of [{ lyrics: 'x'.repeat(3001) }, { styles: 'x'.repeat(501) }]) expect(() => buildCustomQuote({ ...custom, ...patch }, e, 0, true)).toThrow('over_length');
});
test('locked plan cannot build either payload; blockers cover balance, slots and expiry', () => {
    const locked = { ...e, models: e.models.map(m => ({ ...m, available: false })) };
    expect(modelState(locked.models[1], locked)).toBe('locked_plan');
    expect(() => buildCustomQuote(custom, locked, 0, true)).toThrow('locked_plan');
    expect(() => buildSimpleQuote({ ...input, model_id: custom.model_id }, locked)).toThrow('locked_plan');
    expect(quoteBlockers({ input, entitlements: e, rights: false, activeCount: 4, quote: { ...quote, affordable: false, expires_at: '2000-01-01' } })).toEqual(['no_slot', 'not_affordable', 'quote_expired']);
});
