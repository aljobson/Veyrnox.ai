import * as Crypto from 'expo-crypto';
import { ApiError, type ApiClient } from './api';
import { DEV_MOCK } from './config';

// Playback of one Cinema title: mint a short-lived token, play Stream's HLS manifest, renew the token before
// it lapses, and report visible playing time. Mirrors the web player (app/veyrnox/social-cinema/watch/[id]/Player.js).
export const HEARTBEAT_SECONDS = 30;
// A playback token lives 15 minutes; ask for the next one this long before it lapses.
export const RENEW_BEFORE_MS = 3 * 60 * 1000;

const CUSTOMER_CODE = /^[a-z0-9]{1,64}$/;
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PlayGrant {
    readonly token: string;
    readonly customerCode: string;
    readonly expiresAt: number;
    readonly watchSessionId: string | null;
}

export function parseGrant(body: unknown): PlayGrant | null {
    if (typeof body !== 'object' || body === null) return null;
    const b = body as Record<string, unknown>;
    const expiresAt = typeof b.expires_at === 'string' ? Date.parse(b.expires_at) : NaN;
    if (typeof b.customer_code !== 'string' || !CUSTOMER_CODE.test(b.customer_code)) return null;
    if (typeof b.token !== 'string' || !JWT.test(b.token) || !Number.isFinite(expiresAt)) return null;
    const watch = typeof b.watch_session_id === 'string' && UUID.test(b.watch_session_id) ? b.watch_session_id : null;
    return { token: b.token, customerCode: b.customer_code, expiresAt, watchSessionId: watch };
}

// Development only: the mock server cannot mint a Stream token, so a public HLS stream stands in for it.
const DEV_HLS = DEV_MOCK ? process.env.EXPO_PUBLIC_DEV_HLS_URL : undefined;

// Only Stream's own host, built from the server's customer code and the token, ever reaches the player.
export function manifestUrl(grant: Pick<PlayGrant, 'token' | 'customerCode'>, devOverride: string | undefined = DEV_HLS): string {
    if (devOverride) return devOverride;
    return `https://customer-${grant.customerCode}.cloudflarestream.com/${grant.token}/manifest/video.m3u8`;
}

export type BlockReason =
    | 'free_ceiling'
    | 'pass_ceiling'
    | 'locked'
    | 'not_ready'
    | 'missing'
    | 'closed'
    | 'rate_limited'
    | 'signin'
    | 'network'
    | 'error';

export const BLOCK_COPY: Record<BlockReason, string> = {
    free_ceiling: 'You have reached the free viewing limit for this month. Free viewing starts again next month.',
    pass_ceiling: 'You have reached your viewing limit for this month.',
    locked: 'This title is not available to watch in the app yet.',
    not_ready: 'This video is still being prepared. Try again in a few minutes.',
    missing: 'This title is not available.',
    closed: 'Cinema viewing is not open yet.',
    rate_limited: 'Too many requests. Try again in a minute.',
    signin: 'Sign in to watch.',
    network: 'No connection. Check your network and try again.',
    error: 'Playback is unavailable right now. Try again in a moment.',
};

// Reasons that mean the viewer may not watch any more: playback stops and the reason is shown.
const STOPPING: readonly BlockReason[] = ['free_ceiling', 'pass_ceiling', 'locked'];
export const isStopping = (r: BlockReason): boolean => STOPPING.includes(r);

export function classifyPlayError(err: unknown): BlockReason {
    if (!(err instanceof ApiError)) return 'error';
    if (err.status === 0) return 'network';
    if (err.status === 401) return 'signin';
    const reason = err.body.reason;
    if (err.code === 'locked') return reason === 'free_ceiling' || reason === 'pass_ceiling' ? reason : 'locked';
    // Free viewing only: the server answers a paid title with unlocks_not_open.
    if (err.code === 'unlocks_not_open') return 'locked';
    if (err.code === 'not_ready') return 'not_ready';
    if (err.code === 'content_not_found') return 'missing';
    if (err.code === 'rate_limited' || err.status === 429) return 'rate_limited';
    if (err.code === 'playback_not_configured' || err.code === 'viewing_not_open' || err.status === 503) return 'closed';
    return 'error';
}

export const msUntilRenewal = (expiresAt: number, now: number): number => expiresAt - RENEW_BEFORE_MS - now;

/** Visible playback wall time, not time spent on the screen. A delayed beat can send at most 60 seconds. */
export function createPlaybackMeter(now: () => number = Date.now) {
    let playing = false;
    let visible = true;
    let last = now();
    let pending = 0;
    const accrue = () => {
        const next = now();
        if (playing && visible) pending = Math.min(60_000, pending + Math.max(0, next - last));
        last = next;
    };
    return {
        setPlaying(value: boolean) { accrue(); playing = value; },
        setVisible(value: boolean) { accrue(); visible = value; },
        isPlaying: () => playing && visible,
        takeSeconds(): number {
            accrue();
            const seconds = Math.floor(pending / 1000);
            pending -= seconds * 1000;
            return seconds;
        },
    };
}

export interface Coverage {
    readonly seconds: number;
    readonly ranges: [number, number][];
}

/** Conservative full-second timeline coverage. Seeking, paused media and implausible jumps contribute nothing. */
export function createWatchCoverage(now: () => number = Date.now) {
    let prior: { position: number; time: number; playing: boolean } | null = null;
    let anchor: number | null = null;
    let ranges: [number, number][] = [];
    let seconds = 0;
    return {
        sample(position: number, playing: boolean) {
            const time = now();
            if (prior && playing && prior.playing && Number.isFinite(position) && position >= 0) {
                const elapsed = Math.max(0, (time - prior.time) / 1000);
                const delta = position - prior.position;
                if (delta > 0 && delta <= elapsed * 1.25 + 0.5) {
                    const from = anchor ?? Math.ceil(prior.position);
                    const to = Math.floor(position);
                    if (to > from && to <= 600 && seconds + to - from <= 60 && ranges.length < 60) {
                        ranges.push([from, to]);
                        seconds += to - from;
                        anchor = to;
                    }
                } else anchor = Math.ceil(position);
            } else anchor = Number.isFinite(position) ? Math.ceil(position) : null;
            prior = Number.isFinite(position) ? { position, time, playing } : null;
        },
        reset() { prior = null; anchor = null; },
        take(): Coverage | null {
            if (!seconds) return null;
            const result = { seconds, ranges };
            ranges = [];
            seconds = 0;
            return result;
        },
    };
}

export type SessionState = { kind: 'loading' } | { kind: 'playing' } | { kind: 'blocked'; reason: BlockReason };

// The slice of expo-video's VideoPlayer the session drives.
export interface PlayerLike {
    currentTime: number;
    readonly playing: boolean;
    play(): void;
    pause(): void;
    replaceAsync(source: { uri: string }): Promise<void>;
}

export interface SessionDeps {
    readonly api: Pick<ApiClient, 'request'>;
    readonly player: PlayerLike;
    readonly onState: (state: SessionState) => void;
    readonly now?: () => number;
    readonly newKey?: () => string;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const defaultKey = (): string => Crypto.randomUUID();

export function createPlaybackSession(deps: SessionDeps) {
    const { api, player, onState } = deps;
    const now = deps.now ?? Date.now;
    const newKey = deps.newKey ?? defaultKey;
    const meter = createPlaybackMeter(now);
    const coverage = createWatchCoverage(now);

    let contentId = '';
    let grant: PlayGrant | null = null;
    let active = false;
    let blocked = false;
    let minting = false;
    let resume: { time: number; playing: boolean } | null = null;
    let lastBeat = now();
    let beating = false;
    let audienceSending = false;
    let pendingAudience: { key: string; body: string } | null = null;

    function block(reason: BlockReason) {
        if (blocked) return;
        blocked = true;
        meter.setPlaying(false);
        player.pause();
        onState({ kind: 'blocked', reason });
    }

    async function mint(renewal: boolean) {
        if (minting) return;
        minting = true;
        try {
            const body = await api.request<unknown>('/api/v1/cinema/play', {
                method: 'POST',
                headers: JSON_HEADERS,
                body: JSON.stringify({ content_id: contentId }),
            });
            if (!active || blocked) return;
            const next = parseGrant(body);
            if (!next) return block('error');
            grant = next;
            if (renewal) {
                // Keep the place: swap the source, then seek back and resume once the new one has loaded.
                resume = { time: player.currentTime, playing: player.playing };
                meter.setPlaying(false);
                coverage.reset();
            }
            await player.replaceAsync({ uri: manifestUrl(next) });
            if (!active || blocked) return;
            if (renewal) {
                const prior = resume;
                resume = null;
                if (prior) {
                    player.currentTime = prior.time;
                    if (prior.playing) player.play();
                }
            } else {
                player.play();
                onState({ kind: 'playing' });
            }
        } catch (err) {
            if (!active) return;
            const reason = classifyPlayError(err);
            resume = null;
            // A failed renewal keeps the current token playing until it lapses; the next tick tries again.
            if (!renewal || isStopping(reason) || (grant !== null && now() >= grant.expiresAt)) block(reason);
        } finally {
            minting = false;
        }
    }

    function flushAudience() {
        if (audienceSending || !grant?.watchSessionId) return;
        if (!pendingAudience) {
            const data = coverage.take();
            if (data) pendingAudience = { key: newKey(), body: JSON.stringify({ action: 'watch', session_id: grant.watchSessionId, ...data }) };
        }
        if (!pendingAudience) return;
        const attempt = pendingAudience;
        audienceSending = true;
        // Best effort: a failure never stops playback. A rejected report is dropped, a network failure retried.
        api.request('/api/v1/cinema/audience', { method: 'POST', headers: { ...JSON_HEADERS, 'idempotency-key': attempt.key }, body: attempt.body })
            .then(() => { if (pendingAudience === attempt) pendingAudience = null; })
            .catch((err: unknown) => {
                if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 429 && pendingAudience === attempt) pendingAudience = null;
            })
            .finally(() => { audienceSending = false; });
    }

    function flush() {
        lastBeat = now();
        flushAudience();
        if (beating) return;
        const seconds = meter.takeSeconds();
        if (!seconds) return;
        beating = true;
        api.request<{ reason?: string; access?: string }>('/api/v1/cinema/play/heartbeat', {
            method: 'POST',
            headers: JSON_HEADERS,
            body: JSON.stringify({ content_id: contentId, seconds }),
        })
            .then((h) => {
                if (!active) return;
                if (h.reason === 'free_ceiling' || h.reason === 'pass_ceiling') block(h.reason);
                else if (h.access === 'locked') block('locked');
            })
            .catch((err: unknown) => {
                const reason = classifyPlayError(err);
                if (active && isStopping(reason)) block(reason);
            })
            .finally(() => { beating = false; });
    }

    return {
        start(id: string) {
            contentId = id;
            active = true;
            blocked = false;
            grant = null;
            resume = null;
            lastBeat = now();
            onState({ kind: 'loading' });
            void mint(false);
        },
        setPlaying(value: boolean) {
            if (!active || blocked) return;
            if (resume && value) return; // the swap is still loading
            meter.setPlaying(value);
            if (!value) { coverage.reset(); flush(); }
        },
        setVisible(value: boolean) {
            meter.setVisible(value);
            if (!value) { player.pause(); flush(); }
        },
        // The player itself failed (a bad or expired manifest).
        fail() { block('error'); },
        // Called about once a second while mounted.
        tick() {
            if (!active || blocked || !grant) return;
            if (!resume) coverage.sample(player.currentTime, player.playing && meter.isPlaying());
            if (now() - lastBeat >= HEARTBEAT_SECONDS * 1000) flush();
            if ((meter.isPlaying() || player.playing) && msUntilRenewal(grant.expiresAt, now()) <= 0) void mint(true);
        },
        stop() {
            if (active && !blocked) { meter.setPlaying(false); flush(); }
            active = false;
        },
    };
}

export type PlaybackSession = ReturnType<typeof createPlaybackSession>;
