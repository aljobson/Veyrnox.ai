import {
    FROZEN_AFTER_MS,
    allowSpikeNavigation,
    appendEvent,
    buildReport,
    buildSessionSeed,
    checkFrozen,
    describeMessage,
    editorUrl,
    emptyTracker,
    exportRuns,
    judge,
    parsePageMessage,
    seedSecondsLeft,
    sessionInjection,
    spikeEnabled,
    trackMessage,
    type LogEvent,
} from '../src/lib/editorSpike';

// Tokens are built at run time from parts so no fixture is a real-looking credential.
const utf8Binary = (text: string): string => encodeURIComponent(text).replace(/%([0-9A-F]{2})/g, (_m, h: string) => String.fromCharCode(Number.parseInt(h, 16)));
const b64url = (value: object): string => btoa(utf8Binary(JSON.stringify(value))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fakeToken = (claims: object): string => ['header', b64url(claims), 'signature'].join('.');
const API = 'https://app.example.test';

describe('flag', () => {
    test('only the exact value 1 turns the harness on', () => {
        expect(spikeEnabled('1')).toBe(true);
        for (const value of [undefined, '', '0', 'true', ' 1']) expect(spikeEnabled(value)).toBe(false);
    });
});

describe('navigation and url', () => {
    test('editorUrl joins without doubling the slash', () => {
        expect(editorUrl(`${API}/`)).toBe(`${API}/app/editor`);
        expect(editorUrl(API)).toBe(`${API}/app/editor`);
    });

    test('the web view stays on the editor origin', () => {
        expect(allowSpikeNavigation(`${API}/app/library`, API)).toBe(true);
        expect(allowSpikeNavigation('blob:https://app.example.test/abc', API)).toBe(true);
        expect(allowSpikeNavigation('https://evil.example.test/app/editor', API)).toBe(false);
        expect(allowSpikeNavigation('http://app.example.test/app/editor', API)).toBe(false);
        expect(allowSpikeNavigation('javascript:alert(1)', API)).toBe(false);
        expect(allowSpikeNavigation('not a url', API)).toBe(false);
    });
});

describe('session handoff', () => {
    const exp = 2_000_000_000;

    test('builds an access-token-only record from the token claims', () => {
        const seed = buildSessionSeed(fakeToken({ sub: 'user-1', email: 'a@example.test', exp }));
        expect(seed).toEqual({
            access_token: expect.any(String),
            refresh_token: null,
            token_type: 'bearer',
            expires_at: exp,
            user: { id: 'user-1', email: 'a@example.test' },
        });
    });

    test('omits the email when the token has none', () => {
        expect(buildSessionSeed(fakeToken({ sub: 'user-1', exp }))?.user).toEqual({ id: 'user-1' });
    });

    test('reads a non-ASCII email as UTF-8', () => {
        expect(buildSessionSeed(fakeToken({ sub: 'user-1', email: 'zoë@example.test', exp }))?.user.email).toBe('zoë@example.test');
    });

    test('refuses a token without sub or exp, or one that is not a token', () => {
        expect(buildSessionSeed(fakeToken({ exp }))).toBeNull();
        expect(buildSessionSeed(fakeToken({ sub: 'user-1' }))).toBeNull();
        expect(buildSessionSeed('nope')).toBeNull();
        expect(buildSessionSeed('a.%%%.c')).toBeNull();
        expect(buildSessionSeed(['a', btoa('[1]'), 'c'].join('.'))).toBeNull();
    });

    test('seconds left counts from the exp claim', () => {
        const seed = buildSessionSeed(fakeToken({ sub: 'user-1', exp: 1000 }));
        expect(seedSecondsLeft(seed!, 400_000)).toBe(600);
        expect(seedSecondsLeft(seed!, 1_100_000)).toBeLessThan(0);
    });

    test('the injected script checks the origin first and never carries a refresh token', () => {
        const seed = buildSessionSeed(fakeToken({ sub: 'user-1', exp }))!;
        const script = sessionInjection(seed, API);
        expect(script.indexOf('location.origin')).toBeLessThan(script.indexOf('setItem'));
        expect(script).toContain(JSON.stringify(API));
        expect(script).toContain('"refresh_token":null');
        expect(script).toContain('veyrnox_supabase_session');
        expect(script.endsWith('true;')).toBe(true);
    });

    test('hostile characters in a claim cannot break out of the script', () => {
        const seed = buildSessionSeed(fakeToken({ sub: 'x</script><b>', email: 'a\u2028b@example.test', exp }))!;
        const script = sessionInjection(seed, API);
        expect(script).not.toContain('</script>');
        expect(script).not.toContain('\u2028');
        // The script still parses.
        expect(() => new Function(script)).not.toThrow();
    });
});

describe('page messages', () => {
    test('parses each message type', () => {
        expect(parsePageMessage('{"type":"ready","href":"/app/editor","webcodecs":true,"offscreenCanvas":false}')).toEqual({
            type: 'ready',
            href: '/app/editor',
            webcodecs: true,
            offscreenCanvas: false,
        });
        expect(parsePageMessage('{"type":"beat","heapMb":120}')).toEqual({ type: 'beat', heapMb: 120 });
        expect(parsePageMessage('{"type":"beat"}')).toEqual({ type: 'beat', heapMb: null });
        expect(parsePageMessage('{"type":"files","count":2,"bytes":5000,"kinds":["video/mp4","video/quicktime",3]}')).toEqual({
            type: 'files',
            count: 2,
            bytes: 5000,
            kinds: ['video/mp4', 'video/quicktime'],
        });
        expect(parsePageMessage('{"type":"export-start"}')).toEqual({ type: 'export-start' });
        expect(parsePageMessage('{"type":"export-end"}')).toEqual({ type: 'export-end' });
        expect(parsePageMessage('{"type":"output","bytes":9,"mime":"video/mp4"}')).toEqual({ type: 'output', bytes: 9, mime: 'video/mp4' });
    });

    test('clamps progress into 0..1', () => {
        expect(parsePageMessage('{"type":"progress","value":1.7}')).toEqual({ type: 'progress', value: 1 });
        expect(parsePageMessage('{"type":"progress","value":-2}')).toEqual({ type: 'progress', value: 0 });
    });

    test('rejects junk, wrong shapes and oversize input', () => {
        for (const raw of ['', 'not json', 'null', '[]', '{"type":"unknown"}', '{"type":"files","count":"2"}', '{"type":"progress","value":"x"}', '{"type":"output","bytes":1}', '{"type":"ready"}']) {
            expect(parsePageMessage(raw)).toBeNull();
        }
        expect(parsePageMessage(`{"type":"error","message":"${'x'.repeat(5000)}"}`)).toBeNull();
    });

    test('truncates a long error message', () => {
        const parsed = parsePageMessage(`{"type":"error","message":"${'x'.repeat(500)}"}`);
        expect(parsed?.type === 'error' && parsed.message.length).toBe(200);
    });

    test('describes messages for the log and skips beats and progress', () => {
        expect(describeMessage({ type: 'beat', heapMb: 1 })).toBeNull();
        expect(describeMessage({ type: 'progress', value: 0.5 })).toBeNull();
        expect(describeMessage({ type: 'files', count: 2, bytes: 3145728, kinds: ['video/mp4'] })).toEqual({ kind: 'files', detail: '2 file(s), 3.0 MB, video/mp4' });
        expect(describeMessage({ type: 'output', bytes: 1048576, mime: 'video/mp4' })).toEqual({ kind: 'output', detail: '1.0 MB video/mp4' });
    });
});

describe('heartbeat tracking', () => {
    test('records the peak heap and clears a frozen mark', () => {
        let t = trackMessage(emptyTracker, { type: 'beat', heapMb: 100 }, 1000);
        t = trackMessage(t, { type: 'beat', heapMb: 80 }, 2000);
        expect(t).toEqual({ lastBeatAt: 2000, peakHeapMb: 100, frozenSince: null });
        const frozen = checkFrozen(t, 2000 + FROZEN_AFTER_MS + 1).tracker;
        expect(frozen.frozenSince).not.toBeNull();
        expect(trackMessage(frozen, { type: 'beat', heapMb: null }, 20_000).frozenSince).toBeNull();
    });

    test('peak stays null when the web view reports no heap', () => {
        expect(trackMessage(emptyTracker, { type: 'beat', heapMb: null }, 1).peakHeapMb).toBeNull();
    });

    test('non-beat messages leave the tracker alone', () => {
        expect(trackMessage(emptyTracker, { type: 'export-start' }, 1)).toBe(emptyTracker);
    });

    test('freezes once, only after the limit, and never before the first beat', () => {
        expect(checkFrozen(emptyTracker, 99_999_999).justFroze).toBe(false);
        const t = trackMessage(emptyTracker, { type: 'beat', heapMb: null }, 1000);
        expect(checkFrozen(t, 1000 + FROZEN_AFTER_MS - 1).justFroze).toBe(false);
        const first = checkFrozen(t, 1000 + FROZEN_AFTER_MS);
        expect(first.justFroze).toBe(true);
        expect(checkFrozen(first.tracker, 1000 + FROZEN_AFTER_MS * 3).justFroze).toBe(false);
    });
});

const at = (s: number): number => 1_000_000 + s * 1000;
const ev = (s: number, kind: LogEvent['kind'], detail?: string): LogEvent => ({ at: at(s), kind, detail });

describe('event log', () => {
    test('keeps the newest events up to the cap', () => {
        let log: readonly LogEvent[] = [];
        for (let i = 0; i < 5; i++) log = appendEvent(log, ev(i, 'note', String(i)), 3);
        expect(log.map((e) => e.detail)).toEqual(['2', '3', '4']);
    });
});

describe('export runs and verdict', () => {
    test('a clean 60 s export in 150 s passes at 2.5x', () => {
        const log = [ev(0, 'export-start'), ev(150, 'output', '40.0 MB video/mp4'), ev(150, 'export-end')];
        const v = judge(log, 60);
        expect(v.ratio).toBeCloseTo(2.5);
        expect(v).toMatchObject({ ratioPass: true, killPass: true, timelinePass: true, finished: true, pass: true });
        expect(exportRuns(log)[0]).toMatchObject({ outputBytes: 40 * 1048576, backgrounded: false, terminatedDuring: false });
    });

    test('exactly 3x passes, just over fails', () => {
        const make = (s: number) => [ev(0, 'export-start'), ev(s, 'output', '1.0 MB video/mp4'), ev(s, 'export-end')];
        expect(judge(make(180), 60).pass).toBe(true);
        expect(judge(make(181), 60).ratioPass).toBe(false);
    });

    test('a kill anywhere in the session fails even when the export finished', () => {
        const log = [ev(0, 'export-start'), ev(10, 'terminated', 'iOS content process terminated'), ev(20, 'export-start'), ev(80, 'output', '1.0 MB video/mp4'), ev(80, 'export-end')];
        const v = judge(log, 60);
        expect(v.killCount).toBe(1);
        expect(v.pass).toBe(false);
        expect(exportRuns(log)[0]).toMatchObject({ terminatedDuring: true, endedAt: null });
    });

    test('a timeline under 60 s cannot pass', () => {
        const log = [ev(0, 'export-start'), ev(20, 'output', '1.0 MB video/mp4'), ev(20, 'export-end')];
        expect(judge(log, 30)).toMatchObject({ ratioPass: true, timelinePass: false, pass: false });
    });

    test('an export with no file seen does not count as finished', () => {
        const v = judge([ev(0, 'export-start'), ev(30, 'export-end')], 60);
        expect(v).toMatchObject({ finished: false, ratio: null, ratioPass: null, pass: false });
    });

    test('uses the last finished run and notes a background during the run', () => {
        const log = [
            ev(0, 'export-start'),
            ev(500, 'output', '1.0 MB video/mp4'),
            ev(500, 'export-end'),
            ev(600, 'export-start'),
            ev(610, 'background'),
            ev(620, 'foreground'),
            ev(700, 'output', '2.0 MB video/mp4'),
            ev(700, 'export-end'),
        ];
        const runs = exportRuns(log);
        expect(runs).toHaveLength(2);
        expect(runs[1]).toMatchObject({ backgrounded: true });
        expect(judge(log, 60).ratio).toBeCloseTo(100 / 60);
    });

    test('events outside a run are ignored and a zero timeline gives no ratio', () => {
        expect(exportRuns([ev(0, 'background'), ev(1, 'output', '1.0 MB video/mp4')])).toEqual([]);
        const log = [ev(0, 'export-start'), ev(5, 'output', '1.0 MB video/mp4'), ev(5, 'export-end')];
        expect(judge(log, 0).ratio).toBeNull();
    });

    test('a second start abandons the open run', () => {
        const runs = exportRuns([ev(0, 'export-start'), ev(5, 'export-start'), ev(9, 'export-end')]);
        expect(runs.map((r) => r.endedAt)).toEqual([null, at(9)]);
    });
});

describe('report', () => {
    const log = [ev(0, 'page', '/app/editor webcodecs=true offscreen=true'), ev(1, 'export-start'), ev(121, 'output', '40.0 MB video/mp4'), ev(121, 'export-end')];
    const report = buildReport({ log, timelineSeconds: 60, device: 'iPhone 15 ios 19.0', appEnv: 'staging', peakHeapMb: null, now: at(200) });

    test('states the verdict, ratio and unknown heap plainly', () => {
        expect(report).toContain('device: iPhone 15 ios 19.0');
        expect(report).toContain('run 1: 120.0 s, 2.00x real time, 40.0 MB');
        expect(report).toContain('web view kills: 0');
        expect(report).toContain('peak JS heap MB: not reported by this web view');
        expect(report).toContain('harness verdict: PASS');
        expect(report).toContain('frame count, audio sync and thumb trim are by hand');
    });

    test('lists every event and carries no token-shaped text', () => {
        expect(report).toContain('export-start');
        expect(report).not.toMatch(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./);
        expect(report).not.toContain('access_token');
    });

    test('an unfinished run reads as unfinished', () => {
        const text = buildReport({ log: [ev(0, 'export-start'), ev(3, 'terminated', 'x')], timelineSeconds: 60, device: 'd', appEnv: 'production', peakHeapMb: 250, now: at(4) });
        expect(text).toContain('run 1: did not finish, no file seen, web view killed');
        expect(text).toContain('peak JS heap MB: 250');
        expect(text).toContain('harness verdict: FAIL');
    });
});
