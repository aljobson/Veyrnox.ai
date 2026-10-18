import { ApiError } from '../src/lib/api';
import {
    classifyPlayError,
    createPlaybackMeter,
    createPlaybackSession,
    createWatchCoverage,
    manifestUrl,
    msUntilRenewal,
    parseGrant,
    RENEW_BEFORE_MS,
    type SessionState,
} from '../src/lib/cinemaPlayback';

const ID = '11111111-1111-4111-8111-111111111111';
const WATCH = '22222222-2222-4222-8222-222222222222';
const token = (n: number) => `head.body${n}.sig`;

describe('grant and manifest', () => {
    const body = { token: token(1), customer_code: 'abc123', expires_at: '2026-10-18T10:15:00Z', watch_session_id: WATCH };
    test('accepts a well-formed grant', () => {
        expect(parseGrant(body)).toMatchObject({ customerCode: 'abc123', watchSessionId: WATCH, expiresAt: Date.parse('2026-10-18T10:15:00Z') });
    });
    test('rejects a customer code or token that could redirect the player', () => {
        expect(parseGrant({ ...body, customer_code: 'a/../b' })).toBeNull();
        expect(parseGrant({ ...body, token: 'not a jwt' })).toBeNull();
        expect(parseGrant({ ...body, expires_at: 'soon' })).toBeNull();
        expect(parseGrant({ ...body, watch_session_id: 'x' })?.watchSessionId).toBeNull();
    });
    test('builds the Stream manifest address', () => {
        expect(manifestUrl({ customerCode: 'abc123', token: 'T.T.T' }, undefined)).toBe('https://customer-abc123.cloudflarestream.com/T.T.T/manifest/video.m3u8');
    });
    test('renews 3 minutes before expiry', () => {
        expect(msUntilRenewal(1_000_000, 1_000_000 - RENEW_BEFORE_MS)).toBe(0);
        expect(msUntilRenewal(1_000_000, 0)).toBeGreaterThan(0);
    });
});

describe('error mapping', () => {
    const err = (status: number, code: string, body: Record<string, unknown> = {}) => new ApiError(status, code, body);
    test.each([
        [err(402, 'locked', { reason: 'free_ceiling' }), 'free_ceiling'],
        [err(402, 'locked', { reason: 'pass_ceiling' }), 'pass_ceiling'],
        [err(402, 'locked'), 'locked'],
        [err(503, 'unlocks_not_open'), 'locked'],
        [err(409, 'not_ready'), 'not_ready'],
        [err(404, 'content_not_found'), 'missing'],
        [err(429, 'rate_limited'), 'rate_limited'],
        [err(503, 'playback_not_configured'), 'closed'],
        [err(401, 'not_authenticated'), 'signin'],
        [err(0, 'network'), 'network'],
        [new Error('x'), 'error'],
    ])('%#', (e, reason) => expect(classifyPlayError(e)).toBe(reason));
});

describe('meter and coverage', () => {
    test('counts only visible playing time', () => {
        let t = 0;
        const m = createPlaybackMeter(() => t);
        m.setPlaying(true);
        t = 10_500;
        m.setVisible(false);
        t = 40_000;
        m.setVisible(true);
        t = 42_000;
        expect(m.takeSeconds()).toBe(12);
        m.setPlaying(false);
        t = 90_000;
        expect(m.takeSeconds()).toBe(0);
    });
    test('coverage ignores a seek', () => {
        let t = 0;
        const c = createWatchCoverage(() => t);
        c.sample(0, true);
        t = 1000; c.sample(1, true);
        t = 2000; c.sample(2, true);
        t = 3000; c.sample(50, true); // a jump
        expect(c.take()).toEqual({ seconds: 2, ranges: [[0, 1], [1, 2]] });
    });
});

type Call = { path: string; body: Record<string, unknown>; headers: Record<string, string> };

function harness(opts: { play?: () => Promise<unknown> | unknown; heartbeat?: () => Promise<unknown> | unknown; audience?: () => Promise<unknown> | unknown } = {}) {
    let t = Date.parse('2026-10-18T10:00:00Z');
    const calls: Call[] = [];
    let mints = 0;
    const states: SessionState[] = [];
    const player = {
        currentTime: 0, playing: false, sources: [] as string[],
        play() { this.playing = true; }, pause() { this.playing = false; },
        async replaceAsync(s: { uri: string }) { this.sources.push(s.uri); },
    };
    const api = {
        async request<T>(path: string, init: RequestInit = {}): Promise<T> {
            const body = init.body ? JSON.parse(String(init.body)) : {};
            calls.push({ path, body, headers: (init.headers ?? {}) as Record<string, string> });
            if (path.endsWith('/play')) {
                if (opts.play) return (await opts.play()) as T;
                mints += 1;
                return { token: token(mints), customer_code: 'abc', expires_at: new Date(t + 900_000).toISOString(), watch_session_id: WATCH } as T;
            }
            if (path.endsWith('/heartbeat')) return ((await opts.heartbeat?.()) ?? { recorded: true, access: 'free' }) as T;
            return ((await opts.audience?.()) ?? { ok: true }) as T;
        },
    };
    let k = 0;
    const session = createPlaybackSession({ api, player, onState: (s) => states.push(s), now: () => t, newKey: () => `key-${++k}` });
    const advance = (ms: number) => { t += ms; };
    const flushPromises = () => new Promise<void>((r) => setTimeout(r, 0));
    const count = (suffix: string) => calls.filter((c) => c.path.endsWith(suffix));
    return { session, player, calls, states, advance, flushPromises, count, mints: () => mints };
}

describe('playback session', () => {
    test('mints once on start, plays the manifest and reports playing', async () => {
        const h = harness();
        h.session.start(ID);
        expect(h.count('/play')).toHaveLength(0 + 1);
        await h.flushPromises();
        expect(h.player.sources).toHaveLength(1);
        expect(h.player.sources[0]).toMatch(/^https:\/\/customer-abc\.cloudflarestream\.com\/.+\/manifest\/video\.m3u8$/);
        expect(h.player.playing).toBe(true);
        expect(h.states.at(-1)).toEqual({ kind: 'playing' });
        expect(h.count('/play')[0].body).toEqual({ content_id: ID });
    });

    test('renews 3 minutes early, swaps the source and resumes where it was', async () => {
        const h = harness();
        h.session.start(ID);
        await h.flushPromises();
        h.session.setPlaying(true);
        h.advance(12 * 60_000 - 1000);
        h.player.playing = true; h.player.currentTime = 700;
        h.session.tick();
        expect(h.mints()).toBe(1); // 11:59 elapsed, not due yet
        h.advance(1000);
        h.session.tick();
        await h.flushPromises();
        expect(h.mints()).toBe(2);
        expect(h.player.sources).toHaveLength(2);
        expect(h.player.currentTime).toBe(700); // seeked back after the swap
        expect(h.player.playing).toBe(true);
    });

    test('a second tick during a renewal does not mint again', async () => {
        const h = harness();
        h.session.start(ID);
        await h.flushPromises();
        h.player.playing = true;
        h.advance(13 * 60_000);
        h.session.tick(); h.session.tick();
        await h.flushPromises();
        expect(h.mints()).toBe(2);
    });

    test('heartbeat counts visible playing seconds only, about every 30 s', async () => {
        const h = harness();
        h.session.start(ID);
        await h.flushPromises();
        h.player.playing = true;
        h.session.setPlaying(true);
        h.advance(20_000);
        h.session.tick();
        expect(h.count('/heartbeat')).toHaveLength(0);
        h.session.setVisible(false); // backgrounded: pauses and reports the 20 s so far
        await h.flushPromises();
        expect(h.player.playing).toBe(false);
        expect(h.count('/heartbeat').map((c) => c.body.seconds)).toEqual([20]);
        h.advance(60_000); // 60 s in the background count for nothing
        h.session.setVisible(true);
        h.session.tick();
        expect(h.count('/heartbeat')).toHaveLength(1);
        h.session.stop();
        await h.flushPromises();
        expect(h.count('/heartbeat')).toHaveLength(1);
    });

    test('a pause stops the clock', async () => {
        const h = harness();
        h.session.start(ID);
        await h.flushPromises();
        h.session.setPlaying(true);
        h.advance(8_000);
        h.session.setPlaying(false);
        await h.flushPromises();
        h.advance(100_000);
        h.session.tick();
        expect(h.count('/heartbeat').map((c) => c.body.seconds)).toEqual([8]);
    });

    test('stops and shows the reason at the free ceiling', async () => {
        const h = harness({ heartbeat: () => ({ recorded: false, access: 'locked', reason: 'free_ceiling' }) });
        h.session.start(ID);
        await h.flushPromises();
        h.player.playing = true;
        h.session.setPlaying(true);
        h.advance(31_000);
        h.session.tick();
        await h.flushPromises();
        expect(h.states.at(-1)).toEqual({ kind: 'blocked', reason: 'free_ceiling' });
        expect(h.player.playing).toBe(false);
    });

    test('a locked answer from the heartbeat stops playback; a network failure does not', async () => {
        let fail: unknown = new ApiError(0, 'network');
        const h = harness({ heartbeat: () => { throw fail; } });
        h.session.start(ID);
        await h.flushPromises();
        h.player.playing = true;
        h.session.setPlaying(true);
        h.advance(31_000); h.session.tick(); await h.flushPromises();
        expect(h.states.at(-1)).toEqual({ kind: 'playing' });
        fail = new ApiError(402, 'locked', {});
        h.advance(31_000); h.session.tick(); await h.flushPromises();
        expect(h.states.at(-1)).toEqual({ kind: 'blocked', reason: 'locked' });
    });

    test('a locked title is refused at mint and nothing plays', async () => {
        const h = harness({ play: () => { throw new ApiError(503, 'unlocks_not_open'); } });
        h.session.start(ID);
        await h.flushPromises();
        expect(h.states.at(-1)).toEqual({ kind: 'blocked', reason: 'locked' });
        expect(h.player.sources).toHaveLength(0);
    });

    test('an audience failure never stops playback and is retried with the same key', async () => {
        let n = 0;
        const h = harness({ audience: () => { n += 1; if (n === 1) throw new ApiError(0, 'network'); return { ok: true }; } });
        h.session.start(ID);
        await h.flushPromises();
        h.player.playing = true;
        h.session.setPlaying(true);
        for (let s = 1; s <= 31; s++) { h.advance(1000); h.player.currentTime = s; h.session.tick(); }
        await h.flushPromises();
        h.advance(31_000); h.session.tick(); await h.flushPromises();
        const sends = h.count('/audience');
        expect(sends.length).toBeGreaterThanOrEqual(2);
        expect(sends[0].headers['idempotency-key']).toBe(sends[1].headers['idempotency-key']);
        expect(sends[0].body).toMatchObject({ action: 'watch', session_id: WATCH });
        expect(h.states.at(-1)).toEqual({ kind: 'playing' });
    });

    test('a failed renewal keeps playing on the old token until it lapses', async () => {
        let first = true;
        const h = harness({ play: () => {
            if (first) { first = false; return { token: token(1), customer_code: 'abc', expires_at: new Date(Date.parse('2026-10-18T10:00:00Z') + 900_000).toISOString() }; }
            throw new ApiError(0, 'network');
        } });
        h.session.start(ID);
        await h.flushPromises();
        h.player.playing = true;
        h.advance(13 * 60_000);
        h.session.tick(); await h.flushPromises();
        expect(h.states.at(-1)).toEqual({ kind: 'playing' });
        h.advance(3 * 60_000);
        h.session.tick(); await h.flushPromises();
        expect(h.states.at(-1)).toEqual({ kind: 'blocked', reason: 'network' });
    });
});
