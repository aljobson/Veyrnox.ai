import { ApiError, type ApiClient } from '../api';
import { getGeneration } from './client';
import { isMusicOff } from './probe';
import type { MusicGeneration, MusicGenerationView, MusicInputSnapshot } from './types';
export const terminalGeneration = (state: string) => ['succeeded', 'partial', 'failed', 'refunded'].includes(state);
export type TrackedGeneration = Readonly<{
    id: string; input: MusicInputSnapshot; createdAt: number; view: MusicGenerationView; missing: boolean;
}>;
type Snapshot = Readonly<{ state: 'on' | 'off'; entries: readonly TrackedGeneration[] }>;
type Options = {
    api: ApiClient; now?: () => number;
    setTimer?: (callback: () => void, delay: number) => () => void;
    subscribeAppState: (callback: (state: string | null | undefined) => void) => () => void;
    initialAppState?: string | null;
};
export function createGenerationTracker(o: Options) {
    const now = o.now ?? Date.now;
    const timer = o.setTimer ?? ((fn, ms) => { const id = setTimeout(fn, ms); return () => clearTimeout(id); });
    let snapshot: Snapshot = { state: 'on', entries: [] }, epoch = 0;
    let active = o.initialAppState === undefined || o.initialAppState === 'active';
    const timers = new Map<string, () => void>(), failures = new Map<string, number>(), flights = new Set<string>(), loaded = new Set<string>();
    const listeners = new Set<() => void>();
    const emit = () => listeners.forEach(fn => fn());
    const cancel = () => { timers.forEach(fn => fn()); timers.clear(); };
    const find = (id: string) => snapshot.entries.find(e => e.id === id);
    function schedule(id: string, delay: number) {
        const entry = find(id);
        if (!active || snapshot.state === 'off' || !entry || entry.missing || (loaded.has(id) && terminalGeneration(entry.view.state)) || timers.has(id) || flights.has(id)) return;
        timers.set(id, timer(() => { timers.delete(id); void poll(id); }, delay));
    }
    function off() { if (snapshot.state === 'off') return; epoch++; cancel(); flights.clear(); snapshot = { ...snapshot, state: 'off' }; emit(); }
    async function poll(id: string) {
        const ticket = epoch; flights.add(id);
        let delay = 2000;
        try {
            const view = await getGeneration(o.api, id);
            if (ticket !== epoch) return;
            failures.delete(id); loaded.add(id);
            snapshot = { ...snapshot, entries: snapshot.entries.map(e => e.id === id ? { ...e, view } : e) }; emit();
        } catch (error) {
            if (ticket !== epoch) return;
            if (isMusicOff(error)) { off(); return; }
            if (error instanceof ApiError && error.status === 404 && error.code === 'not_found') {
                snapshot = { ...snapshot, entries: snapshot.entries.map(e => e.id === id ? { ...e, missing: true } : e) }; emit();
            } else {
                const count = (failures.get(id) ?? 0) + 1; failures.set(id, count);
                delay = Math.min(10000, 2000 * 2 ** count);
            }
        } finally {
            if (ticket === epoch) { flights.delete(id); schedule(id, delay); }
        }
    }
    const unsubscribe = o.subscribeAppState(state => {
        active = state === 'active';
        if (!active) cancel(); else snapshot.entries.forEach(e => schedule(e.id, 800));
    });
    function reset() { epoch++; cancel(); flights.clear(); failures.clear(); loaded.clear(); snapshot = { state: 'on', entries: [] }; emit(); }
    return {
        snapshot: () => snapshot,
        subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
        activeCount: () => snapshot.entries.filter(e => !e.missing && !terminalGeneration(e.view.state)).length,
        off, reset, dispose() { reset(); unsubscribe(); },
        add(result: MusicGeneration, input: MusicInputSnapshot) {
            if (snapshot.state === 'off') return;
            const existing = find(result.generation_id);
            if (existing) { schedule(existing.id, 800); return; }
            const createdAt = now();
            const entry: TrackedGeneration = { id: result.generation_id, input: Object.freeze({ ...input }), createdAt, missing: false,
                view: { id: result.generation_id, state: result.state, model_id: input.model_id, prompt: input.prompt,
                    title: input.title, total_credits: 0, created_at: new Date(createdAt).toISOString(),
                    candidates: result.candidates.map(c => ({ ...c, song_id: null, version_id: null, error_code: null, audio_url: null })) } };
            snapshot = { ...snapshot, entries: [entry, ...snapshot.entries].slice(0, 20) };
            for (const [id, stop] of timers) if (!find(id)) { stop(); timers.delete(id); }
            emit(); schedule(entry.id, 800);
        },
    };
}
