import { ApiError, type ApiClient } from '../api';
import { conflictDraft, createQuote, getCustomDraft, getEntitlements, saveCustomDraft } from './client';
import { createGenerationAttempts } from './attempts';
import { createGenerationTracker } from './queue';
import { buildCustomQuote, buildSimpleQuote, clampDuration, effectiveInput, normalizeInput, quoteBlockers } from './createForm';
import { createQuoteGate } from './shared';
import { isMusicOff, probeMusic } from './probe';
import type { MusicDraft, MusicEntitlements, MusicInputSnapshot } from './types';
const empty: MusicInputSnapshot = { mode: 'simple', model_id: '', prompt: '', title: '', lyrics: '', styles: '', instrumental: true, duration: 60,
    variety: 50, styleInfluence: 0, excludeStyles: '', bpm: '', keyScale: '', timeSignature: '' };
type State = Readonly<{
    status: 'loading' | 'on' | 'off' | 'error'; entitlements: MusicEntitlements | null;
    input: MusicInputSnapshot; rights: boolean; draft: MusicDraft | null; conflict: MusicDraft | null;
    busy: boolean; error: string | null;
}>;
export function createMusicCreateFlow(api: ApiClient, tracker: ReturnType<typeof createGenerationTracker>, mintKey?: () => string) {
    const attempts = createGenerationAttempts(api, mintKey), gate = createQuoteGate();
    let state: State = { status: 'loading', entitlements: null, input: empty, rights: false, draft: null, conflict: null, busy: false, error: null };
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
            if (model) input = normalizeInput(input, model);
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
                ? normalizeInput({ ...empty, model_id: model.id, duration: model.controls.duration_seconds.default }, model) : empty });
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
                const previous = state.entitlements.models.find(m => m.id === state.input.model_id)?.controls;
                const model = result.data.models.find(m => m.id === state.input.model_id);
                const controls = model?.controls;
                const duration = model ? clampDuration(state.input.duration, model) : state.input.duration;
                if (duration !== state.input.duration || controlsChanged(previous, controls)) {
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
            const token = gate.start(); attempts.invalidate(); update({ busy: true, error: null, conflict: null });
            try {
                let payload;
                if (input.mode === 'custom') {
                    if (!state.draft) throw new Error('draft_required');
                    const draft = await saveCustomDraft(api, { revision: state.draft.revision, model_id: input.model_id,
                        lyrics: input.lyrics, styles: input.styles, title: input.title });
                    if (disposed) return;
                    // A stale save still advanced the server revision; preserve newer local text.
                    if (!gate.unchanged(token) || state.status !== 'on') {
                        update({ draft: { ...state.draft, revision: Math.max(state.draft.revision, draft.revision) } });
                        return;
                    }
                    update({ draft }); payload = buildCustomQuote(captured, e, draft.revision, rights);
                } else payload = buildSimpleQuote(captured, e);
                if (!gate.isCurrent(token)) return;
                const quote = await createQuote(api, payload);
                if (disposed || !gate.isCurrent(token) || state.status !== 'on') return;
                if (quote.model_id !== captured.model_id || quote.mode !== captured.mode) throw new ApiError(201, 'bad_response');
                attempts.prepare(quote, { ...captured, ...(captured.mode === 'simple' ? { prompt: captured.prompt.trim(), title: captured.title.trim() } : {}) });
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
            } catch (error) {
                if (!disposed) {
                    if (!gate.unchanged(revision)) attempts.invalidate();
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
        dispose() { disposed = true; gate.invalidate(); attempts.reset(); tracker.dispose(); stopTracker(); listeners.clear(); },
    };
}

function controlsChanged(previous: MusicEntitlements['models'][number]['controls'] | undefined, next: MusicEntitlements['models'][number]['controls'] | undefined): boolean {
    if (!previous || !next) return previous !== next;
    return previous.description !== next.description || previous.seed !== next.seed || previous.variety !== next.variety
        || previous.style_influence !== next.style_influence || previous.exclude_styles !== next.exclude_styles
        || previous.tempo_key_meter !== next.tempo_key_meter || previous.lyrics !== next.lyrics || previous.styles !== next.styles
        || previous.instrumental !== next.instrumental || previous.duration_seconds.min !== next.duration_seconds.min
        || previous.duration_seconds.max !== next.duration_seconds.max || previous.duration_seconds.default !== next.duration_seconds.default
        || previous.duration_price_block_seconds !== next.duration_price_block_seconds;
}
