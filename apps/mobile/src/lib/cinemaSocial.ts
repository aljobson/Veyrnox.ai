import { API_BASE, ApiError, type ApiClient } from './api';

// Cinema's social layer (ADR-0178): saved titles and follows, winners, voting, story polls. Every one of these is behind
// a Cinema switch that is off in production, so each read separates "closed" (the switch is off: say so) from "failed".
// The server is the authority on every rule; nothing here decides who may vote or follow.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 240): string => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

const CLOSED_CODES = ['retention_not_open', 'voting_not_open', 'story_polls_not_open', 'rankings_not_open', 'viewing_not_open', 'profiles_not_open', 'creators_not_open', 'analytics_not_open', 'cinema_not_open', 'pass_not_open'];
export const isClosed = (err: unknown): boolean => err instanceof ApiError && err.status === 503 && CLOSED_CODES.includes(err.code);

// Result of a read that may be closed.
export type Read<T> = { readonly kind: 'ok'; readonly value: T } | { readonly kind: 'closed' } | { readonly kind: 'error'; readonly key: string };

export async function readOf<T>(run: () => Promise<T>): Promise<Read<T>> {
    try {
        return { kind: 'ok', value: await run() };
    } catch (err) {
        return isClosed(err) ? { kind: 'closed' } : { kind: 'error', key: socialErrorKey(err) };
    }
}

// Catalog key for what to tell the person after a failed read or write.
export function socialErrorKey(err: unknown): string {
    if (!(err instanceof ApiError)) return 'common.error';
    if (err.status === 0) return 'cinemaSocial.err.network';
    switch (err.code) {
        case 'profile_required':
            return 'cinemaSocial.err.profile';
        case 'account_not_active':
            return 'cinemaSocial.err.account';
        case 'self_follow_forbidden':
            return 'cinemaSocial.err.selfFollow';
        case 'collection_limit':
            return 'cinemaSocial.err.limit';
        case 'competition_closed':
        case 'poll_closed':
            return 'cinemaSocial.err.ended';
        case 'choice_already_recorded':
            return 'cinemaSocial.err.already';
        case 'content_not_found':
        case 'competition_not_found':
        case 'poll_not_found':
        case 'choice_not_found':
            return 'cinemaSocial.err.gone';
        case 'competition_capacity':
        case 'poll_capacity':
            return 'cinemaSocial.err.full';
        case 'idempotency_conflict':
            return 'cinemaSocial.err.conflict';
        case 'rate_limited':
            return 'cinemaSocial.err.rate';
    }
    if (err.status === 429) return 'cinemaSocial.err.rate';
    if (err.status === 503) return 'cinemaSocial.err.later';
    return 'common.error';
}

const post = <T>(api: Pick<ApiClient, 'request'>, path: string, key: string, payload: Record<string, unknown>) =>
    api.request<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(payload) });

// ---- Saved and follows (GET and POST /api/v1/cinema/retention) ----

export type FollowKind = 'saved' | 'creator' | 'series';
export interface RetentionState {
    readonly saved: boolean;
    readonly followingCreator: boolean;
    readonly followingSeries: boolean;
    readonly ownCreator: boolean;
    readonly creatorId: string | null;
    readonly seriesId: string | null;
}
export interface RetentionItem {
    readonly targetId: string;
    readonly contentId: string;
    readonly title: string;
    readonly creator: string;
}

export function parseRetentionState(body: unknown): RetentionState {
    const b = isObject(body) ? body : {};
    return {
        saved: b.saved === true,
        followingCreator: b.following_creator === true,
        followingSeries: b.following_series === true,
        ownCreator: b.own_creator === true,
        creatorId: isUuid(b.creator_id) ? b.creator_id : null,
        seriesId: isUuid(b.series_id) ? b.series_id : null,
    };
}
export const fetchRetentionState = async (api: Pick<ApiClient, 'request'>, contentId: string) =>
    parseRetentionState(await retentionRequest(api, () => api.request(`/api/v1/cinema/retention?content_id=${encodeURIComponent(contentId)}`)));

export function parseRetentionList(body: unknown): { items: RetentionItem[]; next: string | null } {
    const b = isObject(body) ? body : {};
    const items: RetentionItem[] = [];
    for (const raw of Array.isArray(b.items) ? b.items : []) {
        if (!isObject(raw) || !isUuid(raw.target_id) || !isUuid(raw.content_id)) continue;
        items.push({ targetId: raw.target_id, contentId: raw.content_id, title: str(raw.title, 160) || 'Untitled', creator: str(raw.display_name, 80) || str(raw.username, 30) });
    }
    return { items, next: isUuid(b.next) ? b.next : null };
}
export const fetchRetentionList = async (api: Pick<ApiClient, 'request'>, kind: FollowKind, beforeId: string | null = null) =>
    parseRetentionList(await retentionRequest(api, () => api.request(`/api/v1/cinema/retention?kind=${kind}&limit=20${beforeId ? `&before_id=${encodeURIComponent(beforeId)}` : ''}`)));

export async function setRetention(api: Pick<ApiClient, 'request'>, kind: FollowKind, targetId: string, active: boolean, key: string): Promise<boolean> {
    if (!isUuid(targetId) || !isUuid(key)) throw new ApiError(400, 'invalid_action');
    const r = await retentionRequest(api, () => post<{ active?: unknown }>(api, '/api/v1/cinema/retention', key, { kind, target_id: targetId, active }), true);
    retentionSession(api).listeners.forEach((listener) => listener({ kind, targetId }));
    return r?.active === true;
}

// Session metadata only: no personal collection data is retained here. AuthProvider keeps one API client for
// the app lifetime. Closure survives screen remount/focus and resets with the next app session (new client).
type RetentionApi = Pick<ApiClient, 'request'>;
type RetentionEvent = { kind: FollowKind; targetId: string } | { kind: 'closed' };
const retentionSessions = new WeakMap<RetentionApi, { closed: boolean; listeners: Set<(event: RetentionEvent) => void> }>();
function retentionSession(api: RetentionApi) {
    let session = retentionSessions.get(api);
    if (!session) {
        session = { closed: false, listeners: new Set() };
        retentionSessions.set(api, session);
    }
    return session;
}
export const retentionDisabled = (api: RetentionApi): boolean => retentionSession(api).closed;
const retentionClosedError = () => new ApiError(503, 'retention_not_open');
async function retentionRequest<T>(api: RetentionApi, run: () => Promise<T>, write = false): Promise<T> {
    const session = retentionSession(api);
    if (session.closed) throw retentionClosedError();
    try {
        const value = await run();
        // A completed write remains acknowledged even if a concurrent read closed retention.
        if (session.closed && !write) throw retentionClosedError();
        return value;
    } catch (err) {
        if (err instanceof ApiError && err.status === 503 && err.code === 'retention_not_open' && !session.closed) {
            session.closed = true;
            session.listeners.forEach((listener) => listener({ kind: 'closed' }));
        }
        throw err;
    }
}

// One mounted consumer owns a lifecycle. Disposed writes still settle on the server, but never update
// a replacement component. Kept outside React so the signed-out and unmount guards can be proved in Jest.
export function createRetentionLifecycle(api: RetentionApi, status: string) {
    let live = true;
    let writing = false;
    const active = () => live && status === 'signedIn';
    return {
        start<T>(run: () => T): T | undefined { return active() ? run() : undefined; },
        isWriting: () => writing,
        async write<T>(run: () => Promise<T>, changed: { busy: (busy: boolean) => void; success: (value: T) => void; error: (err: unknown) => void }): Promise<void> {
            if (!active() || writing || retentionDisabled(api)) return;
            writing = true;
            changed.busy(true);
            try {
                const value = await run();
                if (active()) changed.success(value);
            } catch (err) {
                if (active()) changed.error(err);
            } finally {
                writing = false;
                if (active()) changed.busy(false);
            }
        },
        dispose: () => { live = false; writing = false; },
    };
}

export interface RetentionListView {
    readonly items: RetentionItem[];
    readonly next: string | null;
    readonly status: 'loading' | 'ready' | 'closed' | 'error';
    readonly error: string | null;
}
export const emptyRetentionList: RetentionListView = { items: [], next: null, status: 'loading', error: null };

// The mounted list's lifecycle lives here so cursor recovery and mutation races are testable without a renderer.
// Every request still goes through fetchRetentionList/setRetention above.
export function createRetentionList(api: RetentionApi, kind: FollowKind, changed: (view: RetentionListView) => void) {
    let view = emptyRetentionList;
    let live = true;
    let busy = false;
    let revision = 0;
    let reloadPending = false;
    const update = (next: RetentionListView) => { if (live) { view = next; changed(view); } };
    const close = () => {
        revision++;
        reloadPending = false;
        update({ ...emptyRetentionList, status: 'closed' });
    };
    async function load(cursor: string | null): Promise<void> {
        if (!live || busy) return;
        if (retentionDisabled(api)) { close(); return; }
        busy = true;
        const started = revision;
        try {
            let page;
            try {
                page = await fetchRetentionList(api, kind, cursor);
            } catch (err) {
                if (!live || started !== revision) return;
                if (!cursor || !(err instanceof ApiError) || err.status !== 400 || err.code !== 'invalid_cursor') throw err;
                // Discard the deleted cursor before the single recovery attempt. Never recurse on this error.
                cursor = null;
                update({ ...view, next: null, error: null });
                page = await fetchRetentionList(api, kind);
            }
            if (!live || started !== revision) return;
            update({ items: cursor ? [...view.items, ...page.items.filter((x) => !view.items.some((y) => y.targetId === x.targetId))] : page.items,
                next: page.next, status: 'ready', error: null });
        } catch (err) {
            if (!live || started !== revision) return;
            if (retentionDisabled(api)) close();
            else update({ ...view, status: view.status === 'ready' ? 'ready' : 'error', error: socialErrorKey(err) });
        } finally {
            busy = false;
            if (live && reloadPending) {
                reloadPending = false;
                await load(null);
            }
        }
    }
    async function reload() {
        if (!live) return;
        if (retentionDisabled(api)) { close(); return; }
        revision++;
        update({ ...view, next: null, error: null, status: view.status === 'error' ? 'loading' : view.status });
        if (busy) { reloadPending = true; return; }
        await load(null);
    }
    const listener = (event: RetentionEvent) => {
        if (event.kind === 'closed') close();
        else if (event.kind === kind) void reload();
    };
    retentionSession(api).listeners.add(listener);
    if (retentionDisabled(api)) close();
    return {
        getSnapshot: () => view,
        reload,
        loadMore: async () => { if (view.status === 'ready' && view.next && !retentionDisabled(api)) await load(view.next); },
        dispose: () => { live = false; revision++; retentionSession(api).listeners.delete(listener); },
    };
}

// Mounted controls reload only for their title/creator/series. In-flight reads invalidated by a mutation are
// discarded and coalesced into one fresh read; disposed controls never receive a late completion.
export function observeRetentionState(api: RetentionApi, contentId: string, changed: (state: Read<RetentionState>) => void): () => void {
    let live = true;
    let busy = false;
    let revision = 0;
    let pending = false;
    let state: RetentionState | null = null;
    async function reload(): Promise<void> {
        revision++;
        if (busy) { pending = true; return; }
        busy = true;
        do {
            pending = false;
            const started = revision;
            const result = await readOf(() => fetchRetentionState(api, contentId));
            if (live && started === revision) {
                if (result.kind === 'ok') state = result.value;
                changed(result);
            }
        } while (live && pending && !retentionDisabled(api));
        busy = false;
    }
    const listener = (event: RetentionEvent) => {
        if (event.kind === 'closed') {
            revision++;
            pending = false;
            changed({ kind: 'closed' });
        } else if (!state || event.targetId === (event.kind === 'saved' ? contentId : event.kind === 'creator' ? state.creatorId : state.seriesId)) {
            void reload();
        }
    };
    retentionSession(api).listeners.add(listener);
    void reload();
    return () => { live = false; retentionSession(api).listeners.delete(listener); };
}

// ---- Winners (anonymous GET /api/cinema/winners) ----

export interface WinnerTitle {
    readonly id: string;
    readonly title: string;
    readonly rank: number;
}
export interface WinnerWeek {
    readonly id: string;
    readonly name: string;
    readonly endsAt: string;
    readonly titles: readonly WinnerTitle[];
}
export function parseWinners(body: unknown): WinnerWeek[] {
    if (!isObject(body) || !Array.isArray(body.weeks)) return [];
    const weeks: WinnerWeek[] = [];
    for (const w of body.weeks) {
        if (!isObject(w) || !isUuid(w.id)) continue;
        const titles: WinnerTitle[] = [];
        for (const t of Array.isArray(w.titles) ? w.titles : []) {
            if (!isObject(t) || !isUuid(t.id) || typeof t.rank !== 'number') continue;
            titles.push({ id: t.id, title: str(t.title, 160) || 'Untitled', rank: t.rank });
        }
        titles.sort((a, b) => a.rank - b.rank);
        weeks.push({ id: w.id, name: str(w.name, 80), endsAt: str(w.ends_at, 40), titles });
    }
    return weeks;
}
export async function fetchWinners(doFetch: typeof fetch = fetch, base: string = API_BASE): Promise<WinnerWeek[]> {
    let res: Response;
    try {
        res = await doFetch(`${base}/api/cinema/winners`);
    } catch {
        throw new ApiError(0, 'network');
    }
    let body: unknown = null;
    try {
        body = await res.json();
    } catch {
        // Handled below.
    }
    if (!res.ok) throw new ApiError(res.status, isObject(body) && typeof body.error === 'string' ? body.error : 'failed');
    return parseWinners(body);
}

// ---- Voting (GET /api/v1/cinema/voting, POST /api/v1/cinema/votes) ----

export type VoteStatus = 'qualified' | 'under_review' | 'rejected';
export interface VoteCompetition {
    readonly id: string;
    readonly name: string;
    readonly startsAt: string;
    readonly endsAt: string;
    readonly qualifiedVotes: number;
    readonly myVote: VoteStatus | null;
}
const VOTE_STATUSES: readonly string[] = ['qualified', 'under_review', 'rejected'];
export function parseVoting(body: unknown): VoteCompetition[] {
    if (!isObject(body) || !Array.isArray(body.competitions)) return [];
    const out: VoteCompetition[] = [];
    for (const c of body.competitions) {
        if (!isObject(c) || !isUuid(c.id)) continue;
        const mine = isObject(c.my_vote) && VOTE_STATUSES.includes(str(c.my_vote.status)) ? (c.my_vote.status as VoteStatus) : null;
        out.push({ id: c.id, name: str(c.name, 80), startsAt: str(c.starts_at, 40), endsAt: str(c.ends_at, 40), qualifiedVotes: num(c.qualified_votes), myVote: mine });
    }
    return out;
}
export const fetchVoting = async (api: Pick<ApiClient, 'request'>, contentId: string) =>
    parseVoting(await api.request(`/api/v1/cinema/voting?content_id=${encodeURIComponent(contentId)}`));

// A competition is open to vote in between its start and end; the server decides, this only hides a button that would be refused.
export const competitionOpen = (c: VoteCompetition, now: number = Date.now()): boolean => Date.parse(c.startsAt) <= now && now < Date.parse(c.endsAt);

export async function castVote(api: Pick<ApiClient, 'request'>, contentId: string, competitionId: string, key: string): Promise<VoteStatus> {
    if (!isUuid(contentId) || !isUuid(competitionId) || !isUuid(key)) throw new ApiError(400, 'invalid_vote');
    const r = await post<{ status?: unknown }>(api, '/api/v1/cinema/votes', key, { content_id: contentId, competition_id: competitionId });
    return VOTE_STATUSES.includes(str(r?.status)) ? (r.status as VoteStatus) : 'under_review';
}

// ---- Story polls (GET /api/v1/cinema/story-polls, POST /api/v1/cinema/story-choices) ----

export interface PollOption {
    readonly id: string;
    readonly label: string;
    readonly votes: number;
}
export interface StoryPoll {
    readonly id: string;
    readonly question: string;
    readonly closesAt: string;
    readonly isOpen: boolean;
    readonly options: readonly PollOption[];
    readonly myOptionId: string | null;
}
export function parseStoryPolls(body: unknown): StoryPoll[] {
    if (!isObject(body) || !Array.isArray(body.polls)) return [];
    const out: StoryPoll[] = [];
    for (const p of body.polls) {
        if (!isObject(p) || !isUuid(p.id) || !Array.isArray(p.options)) continue;
        const options: PollOption[] = [];
        for (const o of p.options) if (isObject(o) && isUuid(o.id)) options.push({ id: o.id, label: str(o.label, 120), votes: num(o.votes) });
        if (options.length < 2) continue;
        out.push({ id: p.id, question: str(p.question), closesAt: str(p.closes_at, 40), isOpen: p.is_open === true, options, myOptionId: isObject(p.my_choice) && isUuid(p.my_choice.option_id) ? p.my_choice.option_id : null });
    }
    return out;
}
export const fetchStoryPolls = async (api: Pick<ApiClient, 'request'>, contentId: string) =>
    parseStoryPolls(await api.request(`/api/v1/cinema/story-polls?content_id=${encodeURIComponent(contentId)}`));
export async function castChoice(api: Pick<ApiClient, 'request'>, pollId: string, optionId: string, key: string): Promise<void> {
    if (!isUuid(pollId) || !isUuid(optionId) || !isUuid(key)) throw new ApiError(400, 'invalid_choice');
    await post(api, '/api/v1/cinema/story-choices', key, { poll_id: pollId, option_id: optionId });
}

// ---- Audience: a share (POST /api/v1/cinema/audience, action "share") ----

// Tells Cinema a title was shared, for its audience counts (CINEMA_AUDIENCE_ENABLED, off in production). Best effort: it
// never blocks or fails the share, and a closed switch, an offline phone or a missing profile is simply no signal.
export async function recordShare(api: Pick<ApiClient, 'request'>, contentId: string, key: string): Promise<boolean> {
    if (!isUuid(contentId) || !isUuid(key)) return false;
    try {
        await post(api, '/api/v1/cinema/audience', key, { action: 'share', content_id: contentId, kind: 'share' });
        return true;
    } catch {
        return false;
    }
}
