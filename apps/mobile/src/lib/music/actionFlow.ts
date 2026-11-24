import { actionErrorMetadata, type ActionErrorMetadata } from './actionErrorMetadata';
import { ApiError, type ApiClient } from '../api';
import { getCacheUser, subscribeCacheUser } from '../appCache';
import { publishBalance } from '../balanceEvents';
import { ensureOnline } from '../network';
import { getSong } from './client';
import { createActionAttempts } from './actionAttempts';
import { pollUntil, type PollOptions, type PollState } from './actionPoll';
import { createQuoteGate } from './shared';
import { isMusicOff, probeMusic } from './probe';
import type { ActionInput, ActionSpec, MusicActionQuote, MusicActionQuoteBase } from './actionTypes';
import type { MusicSongDetail } from './types';
type State<R, S> = Readonly<{
    status: 'loading' | 'on' | 'off' | 'error'; song: MusicSongDetail | null; input: ActionInput;
    busy: boolean; error: string | null; errorMetadata: ActionErrorMetadata | null; result: R | null; balance: number | null; poll: PollState<S> | null;
}>;
export function createSongActionFlow<R extends { balance_after?: number }, S, Q extends MusicActionQuoteBase = MusicActionQuote>(api: ApiClient, spec: ActionSpec<R, S, Q>, songId: string,
    options: { mintKey?: () => string; poll?: Partial<Pick<PollOptions<S>, 'initialAppState' | 'subscribeAppState' | 'ceilingMs'>> } = {}) {
    const attempts = createActionAttempts(api, spec, options.mintKey), gate = createQuoteGate();
    const empty: State<R, S> = { status: 'loading', song: null, input: { song_id: songId, version_id: '', rights_confirmed: false },
        busy: false, error: null, errorMetadata: null, result: null, balance: null, poll: null };
    let state = empty, disposed = false, confirming = false, loading = false;
    let poll: ReturnType<typeof pollUntil<S>> | null = null;
    const listeners = new Set<() => void>();
    const update = (patch: Partial<State<R, S>>) => { if (!disposed) { state = { ...state, ...patch }; listeners.forEach(fn => fn()); } };
    function off() { gate.invalidate(); attempts.reset(); poll?.dispose(); update({ ...empty, status: 'off' }); }
    function fail(error: unknown) {
        if (disposed) return;
        if (isMusicOff(error)) { off(); return; }
        update({ error: error instanceof ApiError ? error.code : 'network', errorMetadata: actionErrorMetadata(error) });
    }
    function dispose() {
        if (disposed) return;
        disposed = true; gate.invalidate(); attempts.reset(); poll?.dispose(); stopAccount();
        state = empty; listeners.forEach(fn => fn()); listeners.clear();
    }
    const stopAccount = subscribeCacheUser(dispose);
    return {
        attempts, snapshot: () => state, isLive: () => !disposed, fail,
        subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
        async load() {
            if (disposed || loading || confirming || attempts.snapshot()?.phase === 'AMBIGUOUS') return;
            loading = true; const token = gate.start(); attempts.invalidate(); update({ status: 'loading', error: null, errorMetadata: null });
            const result = await probeMusic(() => getSong(api, songId)); loading = false;
            if (disposed || !gate.isCurrent(token)) return;
            if (result.state === 'off' || (result.state === 'on' && (result.data.lifecycle_status === 'trashed' || !result.data.actions.includes(spec.name)))) { off(); return; }
            if (result.state === 'error') { update({ status: 'error', error: result.code }); return; }
            update({ status: 'on', song: result.data, input: { ...state.input, version_id: result.data.version_id } });
        },
        edit(patch: Partial<Pick<ActionInput, 'rights_confirmed' | 'parameters'>>) {
            if (disposed || confirming || attempts.snapshot()?.phase === 'AMBIGUOUS' || state.result) return;
            gate.invalidate(); attempts.invalidate(); update({ input: { ...state.input, ...patch }, busy: false, error: null, errorMetadata: null });
        },
        async review() {
            if (disposed || state.status !== 'on' || state.busy || confirming || state.result || attempts.snapshot()?.phase === 'AMBIGUOUS') return;
            if (!state.input.rights_confirmed) { update({ error: 'source_rights_required', errorMetadata: null }); return; }
            const token = gate.start(), captured = state.input; attempts.invalidate(); update({ busy: true, error: null, errorMetadata: null });
            try {
                // Refresh the source at review time, including server action/lifecycle gating.
                const song = await getSong(api, songId);
                if (disposed || !gate.isCurrent(token)) return;
                if (song.lifecycle_status === 'trashed' || !song.actions.includes(spec.name)) { off(); return; }
                const input = { ...captured, version_id: song.version_id };
                const quote = await spec.quote(api, input);
                if (disposed || !gate.isCurrent(token)) return;
                update({ song, input }); attempts.prepare(quote, input);
            } catch (error) { if (!disposed && (isMusicOff(error) || gate.isCurrent(token))) fail(error); }
            finally { if (gate.isLatestStart(token)) update({ busy: false }); }
        },
        async confirm() {
            const pending = attempts.snapshot();
            if (disposed || state.status !== 'on' || !pending || confirming) return;
            if (pending.phase === 'UNSUBMITTED' && (!pending.quote.affordable || Date.parse(pending.quote.expires_at) <= Date.now())) {
                update({ error: pending.quote.affordable ? 'quote_expired' : 'insufficient_balance', errorMetadata: null }); return;
            }
            confirming = true; update({ busy: true, error: null, errorMetadata: null });
            try {
                await (spec.beforeConfirm ? spec.beforeConfirm() : ensureOnline());
                if (disposed) return;
                const result = await attempts.confirm(pending.quote);
                if (disposed) return;
                update({ result, balance: spec.resultBalanceOnly
                    ? (Number.isFinite(result.balance_after) ? result.balance_after! : null)
                    : result.balance_after ?? (spec.balanceOnReplay === 'omit' ? null : pending.quote.balance_after) });
                // Adoption by a tracker must never block polling or report a false failure after an accepted spend.
                try { spec.accepted?.(api, result, pending.input, pending.quote); } catch { /* polling continues */ }
                poll?.dispose();
                poll = pollUntil({ ...options.poll, read: () => spec.status(api, result), terminal: spec.terminal,
                    onChange(value) { if (value.state === 'off') off(); else update({ poll: value }); } });
                update({ poll: poll.snapshot() });
            } catch (error) { fail(error); }
            finally { confirming = false; update({ busy: false }); }
        },
        refresh: () => poll?.refresh(),
        async refreshBalance() {
            const owner = getCacheUser();
            try {
                const next = await api.getBalance();
                if (!disposed && owner && owner === getCacheUser()) {
                    update({ balance: next.balance });
                    publishBalance(owner, next.balance);
                }
            } catch { /* A failed balance read cannot undo a confirmed cancellation. */ }
        },
        dispose,
    };
}
