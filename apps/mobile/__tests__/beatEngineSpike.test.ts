import { appendEvent, buildReport, judge, median, parsePageMessage, softwareMs, spikeEnabled, type PadSample } from '../src/lib/beatEngineSpike';

const pad = (jsMs: number, graphMs: number, source = 'web'): PadSample => ({ source, jsMs, graphMs, baseMs: 10, outMs: null });

describe('flag', () => {
    test('only the exact value 1 turns the harness on', () => {
        expect(spikeEnabled('1')).toBe(true);
        for (const v of [undefined, '', '0', 'true', ' 1']) expect(spikeEnabled(v)).toBe(false);
    });
});

describe('parsePageMessage', () => {
    test('reads a pad hit', () => {
        expect(parsePageMessage(JSON.stringify({ type: 'pad', source: 'web', jsMs: 1.5, graphMs: 12, baseMs: 10, outMs: null, nativeToPageMs: null }))).toEqual({
            type: 'pad', source: 'web', jsMs: 1.5, graphMs: 12, baseMs: 10, outMs: null, nativeToPageMs: null,
        });
    });
    test('refuses junk, oversize and unknown types', () => {
        for (const raw of ['', 'not json', '[]', '{"type":"nope"}', `{"type":"note","text":"${'x'.repeat(5000)}"}`, '{"type":"pad","source":"web"}']) expect(parsePageMessage(raw)).toBeNull();
    });
    test('clips long text', () => {
        const m = parsePageMessage(JSON.stringify({ type: 'error', message: 'e'.repeat(400) }));
        expect(m && m.type === 'error' && m.message.length).toBe(160);
    });
    test('reads a heartbeat with a null heap', () => {
        const m = parsePageMessage(JSON.stringify({ type: 'beat', tracks: 8, seconds: 3, notes: 40, heapMb: null, state: 'running', audioTime: 3.1, stalls: 0, hidden: false }));
        expect(m).toMatchObject({ type: 'beat', tracks: 8, heapMb: null });
    });
});

describe('judge', () => {
    test('median of software latency decides the pad line', () => {
        expect(median([])).toBeNull();
        expect(median([3, 1, 2])).toBe(2);
        expect(median([1, 2, 3, 4])).toBe(2.5);
        expect(softwareMs(pad(2, 8))).toBe(10);
        expect(judge({ pads: [pad(2, 8), pad(3, 9), pad(1, 7)], maxSeconds: 10, kills: 0, backgroundOk: null }).padPass).toBe(true);
        expect(judge({ pads: [pad(50, 60)], maxSeconds: 10, kills: 0, backgroundOk: null }).padPass).toBe(false);
        expect(judge({ pads: [], maxSeconds: 0, kills: 0, backgroundOk: null }).padPass).toBeNull();
    });
    test('a kill or a short run fails; five minutes passes', () => {
        expect(judge({ pads: [], maxSeconds: 299, kills: 0, backgroundOk: true }).playPass).toBe(false);
        expect(judge({ pads: [], maxSeconds: 300, kills: 0, backgroundOk: true }).playPass).toBe(true);
        expect(judge({ pads: [], maxSeconds: 300, kills: 1, backgroundOk: true }).killPass).toBe(false);
    });
});

describe('log and report', () => {
    test('the log keeps the newest entries', () => {
        let log: readonly { at: number; kind: string }[] = [];
        for (let i = 0; i < 350; i++) log = appendEvent(log, { at: i, kind: 'x' });
        expect(log).toHaveLength(300);
        expect(log[0]!.at).toBe(50);
    });
    test('the report says speaker latency is not included and holds no token', () => {
        const report = buildReport({ device: 'iPhone', verdict: judge({ pads: [pad(1, 5)], maxSeconds: 5, kills: 0, backgroundOk: null }), pads: [pad(1, 5)], peakHeapMb: null, log: [], caps: { a: 1 } });
        expect(report).toContain('speaker path NOT included');
        expect(report).toContain('survived background: not tried');
    });
});
