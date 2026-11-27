import { ApiError, type ApiClient } from '../../src/lib/api';
import { buildCustomQuote, buildSimpleQuote, quoteBlockers } from '../../src/lib/music/createForm';
import { applyReuseToDraft, createQuoteWithContractRefresh, getCustomDraft, getReuseDraftContext, saveCustomDraft, startGeneration } from '../../src/lib/music/client';
import { createMusicCreateFlow } from '../../src/lib/music/createFlow';
import { createGenerationTracker } from '../../src/lib/music/queue';
import { isMusicDraft, isMusicEntitlements, isMusicQuote } from '../../src/lib/music/validate';
import { crunCustom, crunDraft, crunEntitlements, crunQuote, generation } from '../fixtures/musicCreate';
// @ts-ignore The server parser is intentionally shared to prove the exact mobile wire contract.
import { parseCrunMusicQuote } from '../../../../lib/musicCrunContract.js';

const body = (request: jest.Mock, index = request.mock.calls.length - 1) => JSON.parse(request.mock.calls[index][1].body);

test('validates the complete Crun projection, quote controls and immutable draft identity', () => {
    expect(isMusicEntitlements(crunEntitlements)).toBe(true);
    expect(isMusicQuote(crunQuote)).toBe(true);
    expect(isMusicDraft(crunDraft)).toBe(true);
    expect(isMusicEntitlements({ ...crunEntitlements, models: [{ ...crunEntitlements.models[1], counters: undefined }] })).toBe(false);
    expect(isMusicEntitlements({ ...crunEntitlements, models: [{ ...crunEntitlements.models[1], controls: {
        ...crunEntitlements.models[1].controls, suno_model: ['v5'],
    } }] })).toBe(false);
    expect(isMusicEntitlements({ ...crunEntitlements, models: [{ ...crunEntitlements.models[1], controls: {
        ...crunEntitlements.models[1].controls, suno_model_labels: { v6_wild: 'Creative' },
    } }] })).toBe(true);
    for (const suno_model_labels of [
        { v5: 'Old' }, { v6: '' }, { v6: '   ' }, { v6: 'x'.repeat(41) }, { v6: 5 },
    ]) expect(isMusicEntitlements({ ...crunEntitlements, models: [{ ...crunEntitlements.models[1], controls: {
        ...crunEntitlements.models[1].controls, suno_model_labels,
    } }] })).toBe(false);
    expect(isMusicQuote({ ...crunQuote, weirdness: 2 })).toBe(false);
    expect(isMusicDraft({ ...crunDraft, provider_contract: 'unknown' })).toBe(false);
});

test('builds Crun simple/custom payloads from projection controls without tempo fields', () => {
    const simple = buildSimpleQuote({ ...crunCustom, mode: 'simple', prompt: '  warm synths  ', instrumental: false }, crunEntitlements);
    expect(simple).toEqual({ mode: 'simple', provider_contract: 'crun-suno-v1', model_id: 'ace-step-1.5',
        prompt: 'warm synths', instrumental: false, suno_model: 'v6' });
    expect(parseCrunMusicQuote(simple)).toMatchObject({ ok: true, providerContract: 'crun-suno-v1' });
    const custom = buildCustomQuote(crunCustom, crunEntitlements, crunDraft, true);
    expect(custom).toEqual({ mode: 'custom', provider_contract: 'crun-suno-v1', draft_id: crunDraft.id,
        draft_revision: crunDraft.revision, instrumental: false, rights_confirmed: true, duration_seconds: 135,
        suno_model: 'v6_wild', vocal_gender: 'female', style_influence: 70, weirdness: 0.35,
        variety: 75, exclude_styles: 'choir' });
    expect(custom).not.toHaveProperty('bpm');
    expect(custom).not.toHaveProperty('key_scale');
    expect(custom).not.toHaveProperty('time_signature');
    expect(parseCrunMusicQuote(custom).ok).toBe(true);
});

test('advertised daily allowance opts capable clients in without changing legacy wires', () => {
    const enabled = { ...crunEntitlements, daily_allowance: {
        enabled: true, eligible: true, candidates_remaining: 10, pairs_remaining: 5,
        reset_at: '2099-01-02T00:00:00Z',
    } };
    expect(buildSimpleQuote({ ...crunCustom, mode: 'simple', prompt: 'warm synths' }, enabled))
        .toMatchObject({ daily_allowance_capable: true });
    expect(buildCustomQuote(crunCustom, enabled, crunDraft, true))
        .toMatchObject({ daily_allowance_capable: true });
    expect(buildSimpleQuote({ ...crunCustom, mode: 'simple', prompt: 'warm synths' }, crunEntitlements))
        .not.toHaveProperty('daily_allowance_capable');
});

test('uses only projection counters for Crun text limits and requires custom vocal lyrics', () => {
    const model = crunEntitlements.models[1];
    const small = { ...crunEntitlements, models: [{ ...model, counters: { ...model.counters!, lyrics: { max: 2 } } }] };
    expect(quoteBlockers({ input: crunCustom, entitlements: small, rights: true })).toContain('over_length');
    expect(quoteBlockers({ input: { ...crunCustom, lyrics: '' }, entitlements: crunEntitlements, rights: true })).toContain('lyrics_required');
    expect(quoteBlockers({ input: { ...crunCustom, lyrics: '', instrumental: true }, entitlements: crunEntitlements, rights: false })).not.toContain('lyrics_required');
    expect(quoteBlockers({ input: { ...crunCustom, styles: '' }, entitlements: crunEntitlements, rights: true })).toContain('style_required');
    expect(quoteBlockers({ input: { ...crunCustom, styles: '', instrumental: true }, entitlements: crunEntitlements, rights: false })).toContain('style_required');
});

test('client sends contract identity on draft, generation and refreshed quote wires', async () => {
    const request = jest.fn()
        .mockResolvedValueOnce({ provider_contract: 'crun-suno-v1', draft: { ...crunDraft, provider_contract: undefined } })
        .mockResolvedValueOnce({ draft: { ...crunDraft, revision: 1 } })
        .mockResolvedValueOnce(generation);
    const api = { request } as unknown as ApiClient;
    expect((await getCustomDraft(api)).provider_contract).toBe('crun-suno-v1');
    await saveCustomDraft(api, { ...crunDraft, draft_id: crunDraft.id });
    expect(body(request, 1)).toMatchObject({ provider_contract: 'crun-suno-v1', draft_id: crunDraft.id, revision: 0 });
    await startGeneration(api, crunQuote.quote_id, 'music-key-12345678', 'crun-suno-v1');
    expect(body(request, 2)).toEqual({ quote_id: crunQuote.quote_id, idempotency_key: 'music-key-12345678', provider_contract: 'crun-suno-v1' });

    const quoteRequest = jest.fn().mockRejectedValueOnce(new ApiError(409, 'contract_stale')).mockResolvedValueOnce(crunQuote);
    const refresh = jest.fn(async () => buildCustomQuote(crunCustom, crunEntitlements, crunDraft, true));
    await expect(createQuoteWithContractRefresh({ request: quoteRequest } as unknown as ApiClient,
        buildCustomQuote(crunCustom, crunEntitlements, crunDraft, true), refresh)).resolves.toEqual(crunQuote);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(quoteRequest).toHaveBeenCalledTimes(2);

    const draftStaleRequest = jest.fn().mockRejectedValueOnce(new ApiError(409, 'draft_stale')).mockResolvedValueOnce(crunQuote);
    const refreshDraft = jest.fn(async () => buildCustomQuote(crunCustom, crunEntitlements, crunDraft, true));
    await expect(createQuoteWithContractRefresh({ request: draftStaleRequest } as unknown as ApiClient,
        buildCustomQuote(crunCustom, crunEntitlements, crunDraft, true), refreshDraft)).resolves.toEqual(crunQuote);
    expect(refreshDraft).toHaveBeenCalledTimes(1);
});

test('reuse reads and sends the active contract plus immutable draft identity', async () => {
    const context = { source: { has_lyrics: true }, draft_id: crunDraft.id, draft_revision: 4, provider_contract: 'crun-suno-v1' as const };
    const request = jest.fn().mockResolvedValueOnce(context).mockResolvedValueOnce({ draft: { ...crunDraft, revision: 5 }, idempotent: false });
    const api = { request } as unknown as ApiClient;
    expect(await getReuseDraftContext(api, 'song/one', 'version/one')).toEqual(context);
    expect(request.mock.calls[0][0]).toBe('/api/v1/music/songs/song%2Fone/reuse?version_id=version%2Fone');
    await applyReuseToDraft(api, 'song/one', { version_id: 'version/one', provider_contract: context.provider_contract,
        draft_id: context.draft_id, draft_revision: context.draft_revision, reuse_lyrics: true, reuse_styles: false,
        idempotency_key: 'reuse-key-12345678' });
    expect(body(request, 1)).toEqual({ version_id: 'version/one', provider_contract: 'crun-suno-v1', draft_id: crunDraft.id,
        draft_revision: 4, reuse_lyrics: true, reuse_styles: false, idempotency_key: 'reuse-key-12345678' });
});

test('flow refreshes entitlements and draft once after contract_stale, then re-quotes', async () => {
    let saves = 0, draftReads = 0;
    const activeDraft = { ...crunDraft, id: '00000000-0000-4000-8000-000000000099',
        title: 'Active title', lyrics: 'Active lyrics', styles: 'Active styles' };
    const request: jest.Mock = jest.fn(async (path: string, init?: RequestInit): Promise<unknown> => {
        if (path.endsWith('/entitlements')) return crunEntitlements;
        if (path.endsWith('/drafts/custom') && !init) return { provider_contract: 'crun-suno-v1',
            draft: ++draftReads > 1 ? activeDraft : crunDraft };
        if (path.endsWith('/drafts/custom')) {
            if (++saves === 1) throw new ApiError(409, 'contract_stale');
            return { draft: { ...crunDraft, ...JSON.parse(String(init?.body)), revision: 1 } };
        }
        if (path.endsWith('/generation-quotes')) return { ...crunQuote, quote_id: crunQuote.quote_id };
        throw new Error(path);
    });
    const api = { request } as unknown as ApiClient;
    const flow = createMusicCreateFlow(api, createGenerationTracker({ api, subscribeAppState: () => () => {}, setTimer: () => () => {} }));
    await flow.load(); flow.edit({ mode: 'custom' }); await flow.loadDraft(); flow.edit(crunCustom, true); await flow.review();
    const calls = request.mock.calls as [string, RequestInit?][];
    expect(calls.filter(([path]) => path.endsWith('/entitlements'))).toHaveLength(2);
    expect(calls.filter(([path, init]) => path.endsWith('/drafts/custom') && !init)).toHaveLength(2);
    expect(calls.filter(([path]) => path.endsWith('/generation-quotes'))).toHaveLength(1);
    expect(flow.snapshot().error).toBeNull();
    expect(flow.attempts.snapshot()?.quote.provider_contract).toBe('crun-suno-v1');
    expect(flow.attempts.snapshot()?.input).toMatchObject({ title: activeDraft.title, lyrics: activeDraft.lyrics, styles: activeDraft.styles });
    expect(flow.snapshot().input).toMatchObject({ title: activeDraft.title, lyrics: activeDraft.lyrics, styles: activeDraft.styles });
    expect(flow.snapshot().previousText).toEqual({ title: crunCustom.title, lyrics: crunCustom.lyrics, styles: crunCustom.styles });
    expect(saves).toBe(1);
    flow.copyPreviousText();
    expect(flow.snapshot().input).toMatchObject({ title: crunCustom.title, lyrics: crunCustom.lyrics, styles: crunCustom.styles });
    expect(flow.snapshot().previousText).toBeNull();
    flow.dispose();
});

test('daily allowance drift clears the quote and refreshes entitlements before another review', async () => {
    const enabled = { ...crunEntitlements, daily_allowance: {
        enabled: true, eligible: true, candidates_remaining: 2, pairs_remaining: 1,
        reset_at: '2099-01-02T00:00:00Z',
    } };
    let entitlementReads = 0;
    const request: jest.Mock = jest.fn(async (path: string): Promise<unknown> => {
        if (path.endsWith('/entitlements')) return ++entitlementReads === 1 ? enabled : { ...crunEntitlements, daily_allowance: { enabled: false } };
        if (path.endsWith('/generation-quotes')) return { ...crunQuote, mode: 'simple', model_id: 'ace-step-1.5',
            list_credits: 8, total_credits: 0, daily_free_candidates: 2 };
        if (path.endsWith('/generations')) throw new ApiError(409, 'daily_allowance_stale');
        throw new Error(path);
    });
    const api = { request } as unknown as ApiClient;
    const flow = createMusicCreateFlow(api, createGenerationTracker({ api, subscribeAppState: () => () => {}, setTimer: () => () => {} }));
    await flow.load();
    flow.edit({ mode: 'simple', model_id: 'ace-step-1.5', prompt: 'warm synths', instrumental: true });
    await flow.review();
    expect(flow.attempts.snapshot()?.quote.daily_free_candidates).toBe(2);
    await flow.confirm();
    expect(flow.attempts.snapshot()).toBeNull();
    expect(flow.snapshot().error).toBe('daily_allowance_stale');
    expect(flow.snapshot().entitlements?.daily_allowance?.enabled).toBe(false);
    expect(entitlementReads).toBe(2);
    flow.dispose();
});

test('successful confirmation refreshes the daily allowance projection without blocking creation', async () => {
    const enabled = { ...crunEntitlements, daily_allowance: {
        enabled: true, eligible: true, candidates_remaining: 2, pairs_remaining: 1,
        reset_at: '2099-01-02T00:00:00Z',
    } };
    const exhausted = { ...enabled, balance: 100, daily_allowance: {
        enabled: true, eligible: true, candidates_remaining: 0, pairs_remaining: 0,
        reset_at: '2099-01-02T00:00:00Z',
    } };
    let entitlementReads = 0;
    const request: jest.Mock = jest.fn(async (path: string, init?: RequestInit): Promise<unknown> => {
        if (path.endsWith('/entitlements')) return ++entitlementReads === 1 ? enabled : exhausted;
        if (path.endsWith('/generation-quotes')) return { ...crunQuote, mode: 'simple', model_id: 'ace-step',
            credits_per_candidate: 4, list_credits: 8, total_credits: 0, daily_free_candidates: 2,
            balance: 100, balance_after: 100 };
        if (path.endsWith('/generations') && init?.method === 'POST') return { ...generation, balance_after: 100 };
        throw new Error(path);
    });
    const api = { request } as unknown as ApiClient;
    const flow = createMusicCreateFlow(api, createGenerationTracker({ api, subscribeAppState: () => () => {}, setTimer: () => () => {} }));
    await flow.load();
    flow.edit({ mode: 'simple', model_id: 'ace-step', prompt: 'warm synths', instrumental: true });
    await flow.review();
    await flow.confirm();
    await Promise.resolve();
    expect(flow.snapshot().entitlements?.daily_allowance?.candidates_remaining).toBe(0);
    expect(entitlementReads).toBe(2);
    flow.dispose();
});
