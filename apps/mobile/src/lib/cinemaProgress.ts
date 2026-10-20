import { API_BASE, ApiError, type ApiClient } from './api';
import { isUuid, socialErrorKey } from './cinemaSocial';

const PATH = '/api/v1/cinema/progress';
const CADENCE = 15_000;
const FLOOR = 10_000;

// AuthProvider calls this synchronously, before its asynchronous cache/storage work or React render.
// Keeping identity separate from tokens lets teardown and retries survive screen unmount safely.
export function createProgressIdentity() {
    let userId: string | null = null;
    const listeners = new Set<() => void>();
    return {
        getUserId: () => userId,
        setUser(next: string | null) {
            if (next === userId) return;
            userId = next;
            listeners.forEach((listener) => listener());
        },
        subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    };
}
export const cinemaProgressIdentity = createProgressIdentity();

type Identity = ReturnType<typeof createProgressIdentity>;
type Event = { kind: 'closed' | 'ineligible' | 'identity' | 'changed'; contentId?: string };
type Owner = { userId: string; contentId: string; generation: number };
type Title = {
    generation: number;
    lastSave: number;
    dismissed: boolean;
    hidden: boolean;
    tail: Promise<unknown>;
    retry?: ReturnType<typeof setTimeout>;
};
export interface ProgressItem {
    readonly contentId: string;
    readonly title: string;
    readonly creator: string;
    readonly position: number;
    readonly duration: number;
}
interface Page { items: ProgressItem[]; next: string | null }
interface SaveResult { recorded: boolean; completed: boolean }
interface ProgressDeps {
    identity: Identity;
    getAccessToken(forceRefresh?: boolean): Promise<string | null>;
    fetch?: typeof fetch;
    baseUrl?: string;
}
const cancelled = () => new ApiError(0, 'progress_cancelled');

export function createProgressClient(deps: ProgressDeps) {
    const { identity } = deps;
    const doFetch = deps.fetch ?? fetch;
    let closed = false;
    let notEligible = false;
    let epoch = 0;
    let backoffUntil = 0;
    const titles = new Map<string, Title>();
    const requests = new Set<{ userId: string; controller: AbortController }>();
    const listeners = new Set<(event: Event) => void>();
    const emit = (event: Event) => listeners.forEach((listener) => listener(event));
    const cancelRetry = (title: Title) => { if (title.retry !== undefined) clearTimeout(title.retry); title.retry = undefined; };
    const bump = (title: Title) => { cancelRetry(title); return ++title.generation; };
    function abortAll() {
        titles.forEach(cancelRetry);
        requests.forEach(({ controller }) => controller.abort());
    }
    identity.subscribe(() => {
        epoch++;
        abortAll();
        titles.clear();
        notEligible = false;
        backoffUntil = 0;
        emit({ kind: 'identity' });
    });
    function titleFor(id: string): Title {
        let title = titles.get(id);
        if (!title) {
            title = { generation: 0, lastSave: -Infinity, dismissed: false, hidden: false, tail: Promise.resolve() };
            titles.set(id, title);
        }
        return title;
    }
    const current = (owner: Owner, title: Title) => !closed && !notEligible && identity.getUserId() === owner.userId &&
        titles.get(owner.contentId) === title && title.generation === owner.generation;
    function serial<T>(title: Title, run: () => Promise<T>): Promise<T> {
        const result = title.tail.then(run);
        title.tail = result.catch(() => undefined);
        return result;
    }

    // The shared API client refreshes/replays internally without an owner hook. Keep that small transport
    // here instead: check both sides of every token await and immediately before each fetch, including replay.
    async function request<T>(userId: string, path: string, init: RequestInit = {}): Promise<T> {
        const started = epoch;
        const controller = new AbortController();
        const owned = { userId, controller };
        const check = () => {
            if (closed) throw new ApiError(503, 'watch_progress_not_open');
            if (notEligible) throw cancelled();
            if (controller.signal.aborted || epoch !== started || identity.getUserId() !== userId) throw cancelled();
        };
        check();
        if (Date.now() < backoffUntil) throw new ApiError(429, 'rate_limited');
        requests.add(owned);
        async function token(force = false) {
            check();
            const value = await deps.getAccessToken(force);
            check();
            if (!value) throw new ApiError(401, 'not_authenticated');
            return value;
        }
        async function send(accessToken: string) {
            check();
            try {
                return await doFetch(`${deps.baseUrl ?? API_BASE}${path}`, {
                    ...init, cache: 'no-store', signal: controller.signal,
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
                });
            } catch { check(); throw new ApiError(0, 'network'); }
        }
        try {
            const accessToken = await token();
            let res = await send(accessToken);
            check();
            if (res.status === 401) {
                const refreshed = await token(true);
                if (refreshed !== accessToken) res = await send(refreshed);
            }
            const body = await res.json();
            check();
            if (!res.ok) {
                const error = new ApiError(res.status, typeof body?.error === 'string' ? body.error : 'unknown');
                if (res.status === 503 && error.code === 'watch_progress_not_open') {
                    closed = true;
                    abortAll();
                    emit({ kind: 'closed' });
                }
                if (res.status === 403 && (error.code === 'profile_required' || error.code === 'account_not_active')) {
                    // This viewer cannot use progress. Suppress it until identity changes, without
                    // closing the feature for other accounts or surfacing an empty-row error.
                    notEligible = true;
                    abortAll();
                    emit({ kind: 'ineligible' });
                }
                if (res.status === 429) {
                    const wait = Number(res.headers.get('retry-after'));
                    backoffUntil = Date.now() + (Number.isFinite(wait) && wait > 0 ? wait : 60) * 1000;
                }
                throw error;
            }
            return body as T;
        } finally { requests.delete(owned); }
    }
    function schedule(owner: Owner, title: Title, position: number, delay: number) {
        if (!current(owner, title) || title.dismissed) return;
        cancelRetry(title);
        title.retry = setTimeout(() => {
            title.retry = undefined;
            if (current(owner, title) && !title.dismissed) void write(owner, title, position, false, true);
        }, Math.max(FLOOR, delay));
    }
    async function write(owner: Owner, title: Title, position: number, retryFinal: boolean, final = retryFinal): Promise<void> {
        await serial(title, async () => {
            if (!current(owner, title) || title.dismissed) return;
            if (Date.now() < backoffUntil) {
                // A different request may extend backoff after this timer was scheduled. Waiting
                // does not spend its one retry: keep the final position until a PUT can be sent.
                if (final) schedule(owner, title, position, backoffUntil - Date.now());
                return;
            }
            title.lastSave = Date.now();
            try {
                const result = await request<SaveResult>(owner.userId, PATH, { method: 'PUT', body: JSON.stringify({ content_id: owner.contentId, position_seconds: position }) });
                if (identity.getUserId() !== owner.userId || titles.get(owner.contentId) !== title) return;
                // Even a completed response for an older generation cancels pending retries. A dismissed
                // title stays hidden; a late PUT can never insert an item into the mounted row.
                if (result.completed) {
                    bump(title);
                    title.hidden = true;
                    emit({ kind: 'changed', contentId: owner.contentId });
                } else if (current(owner, title) && !title.dismissed) {
                    if (!result.recorded && retryFinal) schedule(owner, title, position, FLOOR);
                    if (result.recorded) {
                        title.hidden = false;
                        emit({ kind: 'changed', contentId: owner.contentId });
                    }
                }
            } catch (error) {
                // Saving is always best effort and never rejects into the player's lifecycle.
                if (retryFinal && error instanceof ApiError && error.status === 429) schedule(owner, title, position, backoffUntil - Date.now());
            }
        });
    }
    const client = {
        isClosed: () => closed,
        isNotEligible: () => notEligible,
        getUserId: identity.getUserId,
        isHidden: (id: string) => titles.get(id)?.hidden === true,
        subscribe(listener: (event: Event) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        // Explicit new playback may record a dismissed title again. Merely opening a player must not
        // cancel a final retry: its play grant might fail before any newer position can be saved.
        beginPlayback(id: string) {
            if (!identity.getUserId() || closed || notEligible || !isUuid(id)) return;
            const title = titleFor(id);
            if (title.dismissed) { bump(title); title.lastSave = -Infinity; }
            title.dismissed = false;
        },
        recorder(id: string) {
            const userId = identity.getUserId();
            const started = epoch;
            client.beginPlayback(id);
            return (position: number, final: boolean) => {
                if (started !== epoch || identity.getUserId() !== userId) return Promise.resolve();
                return client.save(id, position, final);
            };
        },
        async save(id: string, position: number, final = false): Promise<void> {
            const userId = identity.getUserId();
            if (!userId || closed || notEligible || !isUuid(id) || !Number.isFinite(position)) return;
            const title = titleFor(id);
            if (title.dismissed || (!final && (Date.now() - title.lastSave < CADENCE || Date.now() < backoffUntil))) return;
            const owner = { userId, contentId: id, generation: bump(title) };
            await write(owner, title, Math.max(0, Math.min(600, Math.floor(position))), final);
        },
        async dismiss(id: string): Promise<void> {
            const userId = identity.getUserId();
            if (!userId || closed || notEligible || !isUuid(id)) return;
            const title = titleFor(id);
            bump(title);
            title.dismissed = true;
            // DELETE is enqueued before notifying lists, so their refresh waits behind the mutation.
            const removed = serial(title, async () => {
                if (closed || notEligible || identity.getUserId() !== userId || titles.get(id) !== title) return;
                await request(userId, `${PATH}?content_id=${encodeURIComponent(id)}`, { method: 'DELETE' });
                if (!closed && identity.getUserId() === userId && titles.get(id) === title) {
                    title.hidden = true; emit({ kind: 'changed', contentId: id });
                }
            });
            try { await removed; }
            catch (error) { if (!notEligible) throw error; }
        },
        async list(cursor: string | null = null): Promise<Page> {
            const userId = identity.getUserId();
            if (!userId) throw new ApiError(401, 'not_authenticated');
            if (notEligible) return { items: [], next: null };
            let body: { items?: unknown[]; next?: unknown };
            try {
                body = await request(userId, `${PATH}?limit=20${cursor ? `&before_id=${encodeURIComponent(cursor)}` : ''}`);
            } catch (error) {
                if (notEligible) return { items: [], next: null };
                throw error;
            }
            const items: ProgressItem[] = [];
            for (const raw of Array.isArray(body.items) ? body.items : []) {
                if (!raw || typeof raw !== 'object') continue;
                const item = raw as Record<string, unknown>;
                if (!isUuid(item.content_id) || typeof item.title !== 'string' ||
                    typeof item.position_seconds !== 'number' || !Number.isSafeInteger(item.position_seconds) || item.position_seconds < 0 ||
                    typeof item.duration_seconds !== 'number' || !Number.isSafeInteger(item.duration_seconds) || item.duration_seconds < 1 || item.duration_seconds > 600 || item.position_seconds > item.duration_seconds) continue;
                items.push({ contentId: item.content_id, title: item.title.slice(0, 160),
                    creator: typeof item.display_name === 'string' ? item.display_name.slice(0, 80) : typeof item.username === 'string' ? item.username.slice(0, 30) : '',
                    position: item.position_seconds, duration: item.duration_seconds });
            }
            return { items, next: isUuid(body.next) ? body.next : null };
        },
    };
    return client;
}
export type ProgressClient = ReturnType<typeof createProgressClient>;

// Like retention, the app's API object owns one terminal flag for the whole app session.
const sessions = new WeakMap<Pick<ApiClient, 'request'>, ProgressClient>();
export function getCinemaProgress(api: Pick<ApiClient, 'request'>, getAccessToken: ProgressDeps['getAccessToken']): ProgressClient {
    let client = sessions.get(api);
    if (!client) {
        client = createProgressClient({ identity: cinemaProgressIdentity, getAccessToken });
        sessions.set(api, client);
    }
    return client;
}

export interface ProgressView {
    items: ProgressItem[];
    next: string | null;
    status: 'loading' | 'ready' | 'closed' | 'error';
    error: string | null;
}
export const emptyProgressView: ProgressView = { items: [], next: null, status: 'loading', error: null };
export function createProgressList(client: ProgressClient, changed: (view: ProgressView) => void) {
    let view = emptyProgressView;
    let live = true;
    let busy = false;
    let revision = 0;
    let pending = false;
    const update = (next: ProgressView) => { if (live) { view = next; changed(view); } };
    const close = () => { revision++; pending = false; update({ ...emptyProgressView, status: 'closed' }); };
    const empty = () => { revision++; pending = false; update({ ...emptyProgressView, status: 'ready' }); };
    async function load(cursor: string | null) {
        if (!live || busy) return;
        if (client.isClosed()) { close(); return; }
        if (!client.getUserId() || client.isNotEligible()) { empty(); return; }
        busy = true;
        const started = revision;
        try {
            let page: Page;
            try { page = await client.list(cursor); }
            catch (error) {
                if (!live || started !== revision) return;
                if (!cursor || !(error instanceof ApiError) || error.code !== 'invalid_cursor' || error.status !== 400) throw error;
                cursor = null;
                update({ ...view, next: null });
                page = await client.list(); // exactly one reset, with old rows still visible
            }
            if (!live || started !== revision) return;
            const items = page.items.filter((item) => !client.isHidden(item.contentId));
            update({ items: cursor ? [...view.items, ...items.filter((item) => !view.items.some((old) => old.contentId === item.contentId))] : items,
                next: page.next === cursor ? null : page.next, status: 'ready', error: null });
        } catch (error) {
            if (!live || started !== revision) return;
            if (client.isClosed()) close();
            else update({ ...view, status: view.status === 'ready' ? 'ready' : 'error', error: socialErrorKey(error) });
        } finally {
            busy = false;
            if (live && pending) { pending = false; await load(null); }
        }
    }
    async function reload() {
        if (!live) return;
        revision++;
        if (client.isClosed()) { close(); return; }
        if (client.isNotEligible()) { empty(); return; }
        update({ ...view, error: null });
        if (busy) { pending = true; return; }
        await load(null);
    }
    const off = client.subscribe((event) => {
        if (event.kind === 'closed') close();
        else if (event.kind === 'ineligible') empty();
        else {
            if (event.kind === 'identity') update({ ...emptyProgressView, status: 'ready' });
            else update({ ...view, items: view.items.filter((item) => !client.isHidden(item.contentId)) });
            void reload();
        }
    });
    if (client.isClosed()) close();
    else if (client.isNotEligible()) empty();
    return {
        getSnapshot: () => view,
        reload,
        loadMore: async () => { if (live && view.status === 'ready' && view.next) await load(view.next); },
        dispose() { live = false; revision++; off(); },
    };
}
