import * as SecureStore from 'expo-secure-store';
import type { ApiClient } from './api';
import type { SessionTask } from '../auth/sessionTask';
import type { CreatorAnswers } from './creatorAnswers';
import { getCacheUser } from './appCache';
import { CREATOR_PROFILE_ENABLED, VIBE_SLOT, fetchVibeStatus, parseVibe, serializeVibe,
    saveVibe, resetVibe, skipVibeStatus, withVibeDeadline, type StoredVibe, type VibeStatus } from './creatorProfile';
import { notifyVibeChanged, notifyVibeIdle } from './vibeEvents';

type Api = Pick<ApiClient, 'request'>;
type State = Omit<StoredVibe, 'version'> | null;
type Guard = () => boolean;
type RecordV2 = { owner: string; value: string; held?: boolean };
type Session = { gen: number; owner: string | null; intentSeq: number; active: number;
    task: SessionTask; pendingWrite: { ticket: number; state: State } | null };
export type VibeIntent = { kind: 'save'; answers: CreatorAnswers } | { kind: 'skip' } | { kind: 'reset' };
export type VibeIntentOutcome = { kind: 'applied'; result: 'ok' | 'unavailable' | 'failed' | 'kept' } |
    { kind: 'superseded' } | { kind: 'stale-session' };
type Result = { result: 'ok' | 'unavailable' | 'failed' | 'kept'; server?: State; noApply?: boolean };
const SLOT = 'veyrnox.vibe.v2';
let session: Session | undefined;
let chain: Promise<void> = Promise.resolve();
let legacyDeleted = false;
const tails = new Map<string, Promise<void>>();
const noop = () => undefined;

function vibeSession(task: SessionTask): Session | null {
    if (!task.current()) return null;
    if (!session || session.gen !== task.gen) {
        session = { gen: task.gen, owner: task.user, intentSeq: 0, active: 0, task, pendingWrite: null };
    }
    return session;
}
const live = (s: Session, task: SessionTask) => task.current() && session === s;
const owned = (owner: string | null | undefined) => Boolean(owner) && owner === getCacheUser();

async function readRecord(): Promise<RecordV2 | null> {
    const raw = await SecureStore.getItemAsync(SLOT);
    try {
        const r = raw ? JSON.parse(raw) : null;
        return r && typeof r.owner === 'string' && typeof r.value === 'string' ? r : null;
    } catch { return null; }
}
// Called only inside the storage queue. All checks run at the native call boundary.
async function writeState(state: State, owner: string | null | undefined, guard: Guard, held = false): Promise<void> {
    if (state) {
        const value = JSON.stringify({ owner, value: serializeVibe(state), ...(held ? { held: true } : {}) });
        if (!guard() || !owned(owner)) return;
        await SecureStore.setItemAsync(SLOT, value);
    } else {
        const r = await readRecord();
        if (!guard() || !owned(owner)) return;
        if (r?.owner === owner) await SecureStore.deleteItemAsync(SLOT);
    }
    if (guard() && owned(owner)) notifyVibeChanged();
}
async function retryPending(): Promise<void> {
    const s = session, pending = s?.pendingWrite;
    if (!s || !pending) return;
    const current = () => live(s, s.task) && pending.ticket === s.intentSeq && s.pendingWrite === pending;
    if (!current()) return;
    try {
        await writeState(pending.state, s.owner, current);
        if (current() && owned(s.owner)) s.pendingWrite = null;
    } catch { /* Keep the hold and retry on the next serial operation. */ }
}
function serial<T>(op: () => Promise<T>, retry = true): Promise<T> {
    const run = chain.then(async () => { if (retry) await retryPending(); return op(); });
    chain = run.then(noop, noop);
    return run;
}
export async function loadVibe(): Promise<StoredVibe | null> {
    return serial(async () => {
        if (!legacyDeleted) {
            await SecureStore.deleteItemAsync(VIBE_SLOT);
            legacyDeleted = true;
        }
        const r = await readRecord();
        return r && owned(r.owner) ? parseVibe(r.value) : null;
    }).catch(() => null);
}
export function storeVibe(v: Omit<StoredVibe, 'version'>, owner: string): Promise<void> {
    return serial(() => writeState(v, owner, () => owned(owner)));
}
export function clearVibe(): Promise<void> {
    const owner = getCacheUser();
    return serial(() => writeState(null, owner, () => owned(owner)));
}
export function clearAllVibes(): Promise<void> {
    return serial(async () => {
        await SecureStore.deleteItemAsync(VIBE_SLOT);
        const r = await readRecord();
        if (r && r.owner !== getCacheUser()) await SecureStore.deleteItemAsync(SLOT);
        notifyVibeChanged();
    }, false);
}
function onTail<T>(owner: string, step: () => Promise<T>): Promise<T> {
    const run = (tails.get(owner) ?? Promise.resolve()).then(step, step);
    tails.set(owner, run.then(noop, noop));
    return run;
}
const intentState = (intent: VibeIntent, synced: boolean): State => intent.kind === 'reset' ? null :
    { state: intent.kind === 'save' ? 'completed' : 'skipped', answers: intent.kind === 'save' ? intent.answers : null, synced };
const serverState = (status: VibeStatus): State | undefined => status.kind === 'none' ? null :
    status.kind === 'chosen' ? status.vibe : undefined;
function equalAnswers(a: CreatorAnswers | null, b: CreatorAnswers | null): boolean {
    if (!a || !b) return a === b;
    return Object.keys({ ...a, ...b }).every(k => a[k as keyof CreatorAnswers] === b[k as keyof CreatorAnswers]);
}
function matches(intent: VibeIntent, state: State): boolean {
    const wanted = intentState(intent, true);
    return wanted === null ? state === null : state !== null && state.state === wanted.state && equalAnswers(state.answers, wanted.answers);
}
async function reconcile(api: Api, intent: VibeIntent, current: Guard): Promise<Result> {
    for (const delay of [1000, 2000, 4000]) {
        if (!current()) return { result: 'failed' };
        await new Promise(resolve => setTimeout(resolve, delay));
        if (!current()) return { result: 'failed' };
        const status = await fetchVibeStatus(api);
        if (!current()) return { result: 'failed' };
        const state = serverState(status);
        if (state !== undefined) return { result: matches(intent, state) ? 'ok' : 'failed', server: state };
    }
    return { result: 'failed' };
}
async function mutate(api: Api, intent: VibeIntent, current: Guard): Promise<Result> {
    const r = intent.kind === 'save' ? await saveVibe(api, intent.answers) :
        intent.kind === 'reset' ? await resetVibe(api) : await skipVibeStatus(api);
    if (!current()) return { result: 'failed' };
    if (r.kind === 'failed') return reconcile(api, intent, current);
    if (r.kind === 'kept') {
        const status = await fetchVibeStatus(api);
        if (!current()) return { result: 'kept' };
        return { result: 'kept', server: status.kind === 'chosen' && status.vibe.state === 'completed' ? status.vibe : null };
    }
    return { result: r.kind === 'skipped' ? 'ok' : r.kind };
}
function applyState(r: Result, intent: VibeIntent): State | undefined {
    if (r.noApply) return undefined;
    if (r.result === 'kept') return r.server ?? null;
    if (r.result === 'ok' || r.result === 'unavailable') return intentState(intent, r.result === 'ok');
    if (r.server !== undefined) return r.server;
    // Skip retains its own offline intent, never an older held choice.
    return intent.kind === 'skip' ? intentState(intent, false) : undefined;
}
export async function runVibeIntent(api: Api, task: SessionTask, intent: VibeIntent): Promise<VibeIntentOutcome> {
    const s = vibeSession(task);
    if (!s?.owner) return { kind: 'stale-session' };
    const ticket = ++s.intentSeq;
    s.pendingWrite = null;
    const current = () => live(s, task) && ticket === s.intentSeq;
    let result: Result = { result: 'failed' };
    s.active++;
    try {
        result = await onTail(s.owner, async (): Promise<Result> => {
            try {
                if (!current()) return { result: 'failed', noApply: true };
                // Persist the hold BEFORE dispatch. An old unsynced value must never undo this intent.
                await serial(async () => {
                    const r = await readRecord();
                    if (!current() || !owned(s.owner)) return;
                    if (r?.owner === s.owner) await SecureStore.setItemAsync(SLOT, JSON.stringify({ ...r, held: true }));
                });
                if (!current()) return { result: 'failed', noApply: true };
                if (intent.kind === 'skip') {
                    await serial(() => writeState(intentState(intent, false), s.owner, current, true));
                    if (!current()) return { result: 'failed', noApply: true };
                }
            } catch { return { result: 'failed', noApply: true }; }
            try { return await mutate(withVibeDeadline(api), intent, () => live(s, task)); }
            catch { return { result: 'failed' }; }
        });
        if (current()) {
            const state = applyState(result, intent);
            if (state !== undefined) {
                try { await serial(() => writeState(state, s.owner, current)); }
                catch {
                    if (current()) s.pendingWrite = { ticket, state };
                    result = { result: 'failed', server: state };
                }
            }
        }
    } catch { result = { result: 'failed' }; }
    finally {
        s.active--;
        if (s.active === 0 && live(s, task)) {
            notifyVibeIdle();
            // Also retry without a mounted Home; no new idle event is emitted by this retry.
            if (s.pendingWrite) void serial(async () => undefined).catch(noop);
        }
    }
    if (!live(s, task)) return { kind: 'stale-session' };
    if (ticket !== s.intentSeq) return { kind: 'superseded' };
    return { kind: 'applied', result: result.result };
}
export const recordVibeSkip = (api: Api, task: SessionTask): Promise<VibeIntentOutcome> => runVibeIntent(api, task, { kind: 'skip' });

function background(task: SessionTask): { s: Session; current: Guard } | null {
    const s = vibeSession(task);
    if (!s?.owner || s.active > 0) return null;
    const seen = s.intentSeq;
    return { s, current: () => live(s, task) && s.intentSeq === seen };
}
export async function runVibeSync(api: Api, task: SessionTask): Promise<void> {
    const job = background(task);
    if (!job) return;
    const { s, current } = job;
    await onTail(s.owner!, async () => {
        try {
            if (!current()) return;
            const record = await serial(async () => {
                const r = await readRecord();
                return current() && owned(s.owner) && r?.owner === s.owner ? r : null;
            });
            if (!current() || !record) return;
            const stored = parseVibe(record.value);
            if (!stored || (!record.held && stored.synced)) return;
            const bounded = withVibeDeadline(api);
            let state: State | undefined;
            if (record.held) {
                state = serverState(await fetchVibeStatus(bounded));
            } else {
                const intent: VibeIntent = stored.state === 'completed' && stored.answers ?
                    { kind: 'save', answers: stored.answers } : { kind: 'skip' };
                const r = await mutate(bounded, intent, current);
                state = r.result === 'unavailable' || (r.result === 'failed' && r.server === undefined) ? undefined : applyState(r, intent);
            }
            if (!current() || state === undefined) return;
            await serial(async () => {
                const now = await readRecord();
                if (!current() || JSON.stringify(now) !== JSON.stringify(record)) return;
                await writeState(state!, s.owner, current);
            });
        } catch { /* Background failures keep the record for the next focus/idle trigger. */ }
    });
}
export async function vibeOffered(api: Api, task: SessionTask): Promise<boolean> {
    if (!CREATOR_PROFILE_ENABLED) return false;
    const job = background(task);
    if (!job) return false;
    const { s, current } = job;
    try {
        const local = await loadVibe();
        if (!current() || !owned(s.owner) || local) return false;
        const status = await fetchVibeStatus(withVibeDeadline(api));
        if (!current() || !owned(s.owner)) return false;
        if (status.kind === 'chosen') {
            await serial(async () => {
                const r = await readRecord();
                if (!current() || (r?.owner === s.owner && parseVibe(r.value))) return;
                await writeState(status.vibe, s.owner, current);
            });
            return false;
        }
        return status.kind === 'none' && current();
    } catch { return false; }
}
