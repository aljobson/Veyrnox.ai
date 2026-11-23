import { ApiError, type ApiClient } from '../api';
import { conflictDraft, createQuoteWithContractRefresh, getCustomDraft, getEntitlements, isContractStale, saveCustomDraft } from './client';
import { createGenerationAttempts } from './attempts';
import { createGenerationTracker } from './queue';
import { buildCustomQuote, buildSimpleQuote, clampDuration, effectiveInput, normalizeInput, quoteBlockers } from './createForm';
import { createQuoteGate } from './shared';
import { isMusicOff, probeMusic } from './probe';
import type { MusicDraft, MusicEntitlements, MusicInputSnapshot } from './types';
const empty: MusicInputSnapshot = { mode: 'simple', model_id: '', prompt: '', title: '', lyrics: '', styles: '', instrumental: true, duration: 60,
    variety: 50, styleInfluence: 0, excludeStyles: '', sunoModel: 'v6', vocalGender: 'auto', weirdness: 0.5,
    bpm: '', keyScale: '', timeSignature: '' };
type State = Readonly<{
    status: 'loading' | 'on' | 'off' | 'error'; entitlements: MusicEntitlements | null;
    input: MusicInputSnapshot; rights: boolean; draft: MusicDraft | null; conflict: MusicDraft | null;
    busy: boolean; error: string | null; previousText: Pick<MusicInputSnapshot, 'title' | 'lyrics' | 'styles'> | null;
}>;
export function createMusicCreateFlow(api: ApiClient, tracker: ReturnType<typeof createGenerationTracker>, mintKey?: () => string) {
    const attempts = createGenerationAttempts(api, mintKey), gate = createQuoteGate();
    let state: State = { status: 'loading', entitlements: null, input: empty, rights: false, draft: null, conflict: null, busy: false, error: null, previousText: null };
    let disposed = false, loading = false, confirming = false, refreshing = false;
    const listeners = new Set<() => void>();
    const emit = () => listeners.forEach(fn => fn());
    const update = (patch: Partial<State>) => { if (!disposed) { state = { ...state, ...patch }; emit(); } };
    function off() { gate.invalidate(); attempts.invalidate(); tracker.off(); update({ status: 'off', busy: false, error: null }); }
    const stopTracker = tracker.subscribe(() => { if (tracker.snapshot().state === 'off' && state.status !== 'off') off(); });
    function fail(error: unknown) {
        if (isMusicOff(error)) { off(); return; }
        const conflict = conflictDraft(error);
        update({ error: conflict ? 'conflict' : error instanceof ApiError
            ? error.code === 'concurrency_limit' ? 'no_slot' : error.code === 'insufficient_balance' ? 'not_affordable' : error.code
            : error instanceof Error ? error.message : 'network', conflict });
    }
    function edit(patch: Partial<MusicInputSnapshot>, rights = state.rights) {
        gate.invalidate(); attempts.invalidate();
        let input = { ...state.input, ...patch };
        const e = state.entitlements;
        if (e) {
            if (patch.mode && !e.models.find(m => m.id === input.model_id)?.generation_modes.includes(patch.mode)) {
                input.model_id = e.models.find(m => m.available && m.generation_modes.includes(input.mode))?.id ?? '';
            }
            const model = e.models.find(m => m.id === input.model_id);
            if (model) {
                if (patch.mode === 'custom' && model.provider_contract === 'crun-suno-v1') {
                    input = { ...input, instrumental: false, sunoModel: 'v6', vocalGender: 'auto',
                        styleInfluence: 50, weirdness: 0.5, variety: 25 };
                }
                input = normalizeInput(input, model);
            }
        }
        update({ input, rights, busy: false, error: null, conflict: null });
    }
    async function loadDraft() {
        if (disposed || state.status !== 'on' || state.draft || state.input.mode !== 'custom' || !state.entitlements?.custom_drafts.available) return;
        const token = gate.start(); update({ busy: true });
        try {
            const draft = await getCustomDraft(api);
            if (disposed || state.status !== 'on') return;
            if (!gate.isCurrent(token)) {
                if (gate.isLatestStart(token) && !state.draft) update({ draft });
                return;
            }
            const model = state.entitlements.models.find(m => m.id === draft.model_id && m.available && m.generation_modes.includes('custom'));
            update({ draft, input: { ...state.input, lyrics: draft.lyrics, styles: draft.styles, title: draft.title,
                ...(model ? { model_id: model.id } : {}) } });
        } catch (error) { if (!disposed && (isMusicOff(error) || gate.isCurrent(token))) fail(error); }
        finally { if (gate.isLatestStart(token)) update({ busy: false }); }
    }
    return {
        attempts, tracker, snapshot: () => state,
        subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
        async load() {
            if (disposed || loading || state.status === 'off' || state.status === 'on') return;
            loading = true; update({ status: 'loading' });
            const result = await probeMusic(() => getEntitlements(api)); loading = false;
            if (disposed || tracker.snapshot().state === 'off') return;
            if (result.state === 'off' || (result.state === 'on' && !result.data.available)) { off(); return; }
            if (result.state === 'error') { update({ status: 'error', error: result.code }); return; }
            const model = result.data.models.find(m => m.available && m.generation_modes.includes('simple'));
            update({ status: 'on', entitlements: result.data, input: model
                ? normalizeInput({ ...empty, ...(model.provider_contract === 'crun-suno-v1' ? { variety: 25, styleInfluence: 50 } : {}),
                    model_id: model.id, duration: model.controls.duration_seconds?.default
                    ?? model.limits?.duration_seconds.default ?? empty.duration }, model) : empty });
        },
        edit, loadDraft,
        async refreshEntitlements() {
            if (disposed || refreshing || state.status !== 'on' || !state.entitlements) return;
            refreshing = true;
            try {
                const result = await probeMusic(() => getEntitlements(api));
                if (disposed || state.status !== 'on') return;
                if (result.state === 'off' || (result.state === 'on' && !result.data.available)) { off(); return; }
                // A background refresh failure must not replace submission recovery state.
                if (result.state === 'error') return;
                const previous = state.entitlements.models.find(m => m.id === state.input.model_id);
                const model = result.data.models.find(m => m.id === state.input.model_id);
                const duration = model ? clampDuration(state.input.duration, model) : state.input.duration;
                if (duration !== state.input.duration || modelChanged(previous, model)) {
                    gate.invalidate();
                    // invalidate keeps ambiguous and in-flight attempts, including their original input/key.
                    attempts.invalidate();
                }
                update({ entitlements: result.data, input: { ...state.input, duration } });
            } finally { refreshing = false; }
        },
        async review() {
            if (disposed || state.status !== 'on' || !state.entitlements || confirming || attempts.snapshot()?.phase === 'AMBIGUOUS') return;
            const e = state.entitlements, input = state.input, rights = state.rights;
            const blockers = quoteBlockers({ input, entitlements: e, rights, activeCount: tracker.activeCount() });
            if (blockers.length) { update({ error: blockers[0] }); return; }
            const model = e.models.find(m => m.id === input.model_id)!;
            const captured = effectiveInput(input, model);
            let preparedInput = captured;
            const token = gate.start(); attempts.invalidate(); update({ busy: true, error: null, conflict: null });
            try {
                let refreshed = false;
                const refreshedPayload = async () => {
                    if (refreshed) throw new ApiError(409, 'contract_stale');
                    refreshed = true;
                    const fresh = await getEntitlements(api);
                    const freshModel = fresh.models.find(m => m.id === captured.model_id && m.available && m.generation_modes.includes(captured.mode));
                    if (!freshModel) throw new ApiError(409, 'model_unavailable');
                    const nextInput = effectiveInput({ ...captured, model_id: freshModel.id }, freshModel);
                    if (captured.mode === 'simple') {
                        preparedInput = nextInput;
                        update({ entitlements: fresh, input: { ...state.input, instrumental: nextInput.instrumental,
                            duration: nextInput.duration, model_id: nextInput.model_id } });
                        return buildSimpleQuote(nextInput, fresh);
                    }
                    const serverDraft = await getCustomDraft(api);
                    const activeInput = effectiveInput({ ...captured, model_id: freshModel.id, title: serverDraft.title,
                        lyrics: serverDraft.lyrics, styles: serverDraft.styles }, freshModel);
                    preparedInput = activeInput;
                    update({ entitlements: fresh, draft: serverDraft, previousText: {
                        title: captured.title, lyrics: captured.lyrics, styles: captured.styles,
                    }, input: { ...state.input, model_id: freshModel.id, title: serverDraft.title,
                        lyrics: serverDraft.lyrics, styles: serverDraft.styles,
                        instrumental: activeInput.instrumental, duration: activeInput.duration } });
                    return buildCustomQuote(activeInput, fresh, serverDraft, rights);
                };
                let payload;
                if (input.mode === 'custom') {
                    if (!state.draft) throw new Error('draft_required');
                    let draft: MusicDraft | undefined;
                    try {
                        draft = await saveCustomDraft(api, { provider_contract: state.draft.provider_contract, draft_id: state.draft.id,
                            revision: state.draft.revision, model_id: input.model_id, lyrics: input.lyrics,
                            styles: input.styles, title: input.title });
                    } catch (error) {
                        if (!isContractStale(error)) throw error;
                        payload = await refreshedPayload();
                    }
                    if (disposed) return;
                    // A stale save still advanced the server revision; preserve newer local text.
                    if (draft && (!gate.unchanged(token) || state.status !== 'on')) {
                        update({ draft: { ...state.draft, revision: Math.max(state.draft.revision, draft.revision) } });
                        return;
                    }
                    if (draft) { update({ draft }); payload = buildCustomQuote(captured, e, draft, rights); }
                } else payload = buildSimpleQuote(captured, e);
                if (!gate.isCurrent(token)) return;
                const quote = await createQuoteWithContractRefresh(api, payload!, refreshedPayload);
                if (disposed || !gate.isCurrent(token) || state.status !== 'on') return;
                if (quote.model_id !== captured.model_id || quote.mode !== captured.mode) throw new ApiError(201, 'bad_response');
                attempts.prepare(quote, { ...preparedInput, ...(preparedInput.mode === 'simple'
                    ? { prompt: preparedInput.prompt.trim(), title: preparedInput.title.trim() } : {}) });
            } catch (error) { if (!disposed && (isMusicOff(error) || gate.isCurrent(token))) fail(error); }
            finally { if (gate.isLatestStart(token)) update({ busy: false }); }
        },
        async confirm() {
            const pending = attempts.snapshot(), e = state.entitlements;
            if (disposed || state.status !== 'on' || !pending || !e || confirming) return;
            const blockers = quoteBlockers({ input: pending.input, entitlements: e, rights: !pending.input.instrumental,
                quote: pending.quote, activeCount: tracker.activeCount(), ambiguous: pending.phase === 'AMBIGUOUS' });
            if (blockers.length) { update({ error: blockers[0] }); return; }
            const revision = gate.current();
            confirming = true; update({ busy: true, error: null });
            try {
                const result = await attempts.confirm(pending.quote);
                if (disposed) return;
                tracker.add(result, pending.input);
                update({ entitlements: { ...state.entitlements!, balance: result.balance_after } });
                void getEntitlements(api).then((fresh) => {
                    if (!disposed) update({ entitlements: fresh });
                }).catch(() => { /* keep the confirmed balance projection */ });
            } catch (error) {
                if (!disposed) {
                    if (!gate.unchanged(revision)) attempts.invalidate();
                    if (error instanceof ApiError && error.code === 'daily_allowance_stale') {
                        attempts.invalidate();
                        try { update({ entitlements: await getEntitlements(api) }); } catch { /* keep the last safe projection */ }
                    }
                    fail(error);
                }
            }
            finally { confirming = false; update({ busy: false }); }
        },
        useServer() {
            const draft = state.conflict; if (!draft) return;
            edit({ title: draft.title, lyrics: draft.lyrics, styles: draft.styles, model_id: draft.model_id });
            update({ draft });
        },
        keepMine() {
            const draft = state.conflict; if (!draft) return;
            gate.invalidate(); attempts.invalidate(); update({ draft, conflict: null, error: null });
        },
        copyPreviousText() {
            if (!state.previousText) return;
            edit(state.previousText);
            update({ previousText: null });
        },
        dispose() { disposed = true; gate.invalidate(); attempts.reset(); tracker.dispose(); stopTracker(); listeners.clear(); },
    };
}

function modelChanged(previous: MusicEntitlements['models'][number] | undefined, next: MusicEntitlements['models'][number] | undefined): boolean {
    return JSON.stringify(previous) !== JSON.stringify(next);
}
