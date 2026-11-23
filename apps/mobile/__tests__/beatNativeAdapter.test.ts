import { chainable, createNativeBeatEngine, nativeDynamicsCompressor, withWindowAudioContext, wrapNativeContext, type NativeContextCtor } from '../src/lib/beatNative/nativeContext';
import { N0_TRACKS, createSession, hermesHeapBytes, n0Enabled } from '../src/lib/beatNative/session';
import { createMockContext, mockAudioContextClass } from './helpers/mockNativeAudio';
import { resetAudioWorklets, workletNodes } from './helpers/mockAudioWorklets';

// Node kinds react-native-audio-api 1.0.1 implements (web-audio-api-coverage.mdx). DynamicsCompressor is absent on purpose.
const SUPPORTED = new Set(['gain', 'oscillator', 'biquad', 'bufferSource', 'buffer', 'delay', 'stereoPanner', 'convolver', 'periodicWave', 'waveShaper']);

describe('wrapNativeContext', () => {
    beforeEach(resetAudioWorklets);
    test('a missing built-in compressor becomes a real worklet processor with Web Audio parameters', () => {
        const { context } = createMockContext();
        const report = { gaps: [] as string[], latencyHint: 'interactive' };
        const wrapped = wrapNativeContext(context as never, report as never) as unknown as Record<string, (settings?: object) => Record<string, { value: number }>>;
        const limiter = wrapped.createDynamicsCompressor({ threshold: -1, knee: 0, ratio: 20, attack: 0.003, release: 0.25 });
        for (const [k, v] of Object.entries({ threshold: -1, knee: 0, ratio: 20, attack: 0.003, release: 0.25 })) limiter[k].value = v;
        expect(limiter.ratio.value).toBe(20);
        expect(workletNodes).toHaveLength(1);
        expect(workletNodes[0].kind).toBe('workletProcessor');
        expect(report.gaps).toEqual([]);
        wrapped.createDynamicsCompressor();
        expect(workletNodes).toHaveLength(2);
        expect(report.gaps).toEqual([]);
    });

    test('connect returns its destination even though the library\'s returns nothing, so the engine\'s chains work', () => {
        const { context } = createMockContext();
        const report = { gaps: [] as string[], latencyHint: 'interactive' };
        const w = wrapNativeContext(context as never, report as never) as unknown as Record<string, () => { connect: (d: unknown) => unknown }>;
        const a = w.createOscillator(), b = w.createGain(), c = w.createGain();
        expect(a.connect(b)).toBe(b);
        expect(b.connect(c)).toBe(c);
        expect(report.gaps).toContain('connectReturnsVoid');
    });

    test('a spec-conforming connect result is passed through', () => {
        const dest = { id: 1 };
        const node = { connect: jest.fn((_d: unknown) => 'spec') };
        expect(chainable(node).connect(dest)).toBe('spec');
        expect(chainable(chainable(node))).toBe(node);
    });

    test('methods stay bound to the native context and plain properties read through', () => {
        const { context } = createMockContext();
        const wrapped = wrapNativeContext(context as never, { gaps: [], latencyHint: 'interactive' });
        const { createGain } = wrapped as unknown as { createGain: () => { kind: string } };
        expect(createGain().kind).toBe('gain');
        expect(wrapped.sampleRate).toBe(48000);
        expect(wrapped.destination).toBe(context.destination);
    });

    test('nativeDynamicsCompressor is a real node so connect chains keep working', () => {
        const { context } = createMockContext();
        const node = nativeDynamicsCompressor(context as never, {}, (_context, settings) => ({
            settings, connect: jest.fn(), disconnect: jest.fn(),
        })) as { connect: (d: unknown) => unknown; reduction: number };
        const next = { kind: 'next' };
        expect(node.connect(next)).toBe(next);
        expect(node.reduction).toBe(0);
    });
});

describe('withWindowAudioContext', () => {
    test('answers window.AudioContext during the call and restores what was there', () => {
        const original = function Original() {};
        const scope: { window?: { AudioContext?: unknown; webkitAudioContext?: unknown } } = { window: { AudioContext: original, webkitAudioContext: 'w' } };
        const ctx = createMockContext().context;
        let seen: unknown;
        const result = withWindowAudioContext(() => ctx as never, () => {
            const Ctor = scope.window!.AudioContext as new () => unknown;
            seen = new Ctor();
            return 'made';
        }, scope);
        expect(result).toBe('made');
        expect(seen).toBe(ctx);
        expect(scope.window!.AudioContext).toBe(original);
        expect(scope.window!.webkitAudioContext).toBe('w');
    });

    test('creates and removes a window when the runtime has none, even if the call throws', () => {
        const scope: { window?: { AudioContext?: unknown } } = {};
        expect(() => withWindowAudioContext(() => ({}) as never, () => { expect(scope.window).toBeDefined(); throw new Error('boom'); }, scope)).toThrow('boom');
        expect(scope.window).toBeUndefined();
    });
});

describe('the shared web engine on a library-shaped context', () => {
    function build() {
        const { Ctor, state } = mockAudioContextClass();
        const win = (globalThis as { window?: { AudioContext?: unknown } }).window;
        const before = win?.AudioContext;
        const native = createNativeBeatEngine({ Context: Ctor as unknown as NativeContextCtor, latencyHint: 'interactive' });
        return { native, state, restored: (globalThis as { window?: { AudioContext?: unknown } }).window?.AudioContext === before };
    }

    test('createBeatEngine runs unmodified and asks for an interactive context', () => {
        const { native, state, restored } = build();
        expect(state.options).toEqual([{ latencyHint: 'interactive' }]);
        expect(native.engine.context.sampleRate).toBe(48000);
        expect(restored).toBe(true);
        expect(native.report.gaps).toEqual(['connectReturnsVoid']);
    });

    test('all eight N0 tracks and a pad build only node kinds the library implements', async () => {
        const { native, state } = build();
        const timers: Array<() => void> = [];
        let wall = 0;
        const session = createSession({
            engine: native.engine, wall: () => wall,
            setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: () => { timers.length = 0; },
            heapBytes: () => 64 * 1048576,
        });
        await session.start();
        const mock = state.last!;
        // Walk two bars of audio time, one scheduler tick at a time.
        for (let i = 0; i < 90; i += 1) {
            mock.context.currentTime += 0.05; wall += 50;
            timers.splice(0).forEach((fn) => fn());
        }
        const reading = session.pad();
        const kinds = new Set(mock.created);
        const missing = [...kinds].filter((kind) => !SUPPORTED.has(kind));
        expect(missing).toEqual([]);
        for (const kind of ['oscillator', 'gain', 'biquad', 'bufferSource', 'waveShaper', 'delay', 'periodicWave', 'stereoPanner']) expect(kinds.has(kind)).toBe(true);
        const stats = session.stats();
        expect(stats.tracks).toBe(N0_TRACKS.length);
        expect(stats.notes).toBeGreaterThan(20);
        expect(stats.heapMb).toBe(64);
        expect(stats.ctxState).toBe('running');
        expect(reading.baseMs).toBeCloseTo(5);
        expect(reading.outMs).toBeCloseTo(20);
        expect(reading.estimateMs).toBeGreaterThanOrEqual(25);
        expect(reading.pass).toBe(true);
        await session.close();
        expect(mock.context.close).toHaveBeenCalled();
    });

    test('gated voices (bass, synth, wavetable) get a release so nothing is held forever', async () => {
        const { native, state } = build();
        const timers: Array<() => void> = [];
        const session = createSession({ engine: native.engine, wall: () => 0, setTimer: (fn) => { timers.push(fn); return 1; }, clearTimer: () => {}, heapBytes: () => null });
        await session.start();
        state.last!.context.currentTime = 0.4;
        timers.splice(0).forEach((fn) => fn());
        const sources = state.last!.nodes.filter((n) => typeof n.stop === 'function');
        // A released gated voice schedules a stop on its sources.
        expect(sources.some((n) => (n.stop as jest.Mock).mock.calls.length > 0)).toBe(true);
        expect(session.stats().heapMb).toBeNull();
    });
});

describe('known gaps pinned (docs/mobile/spikes/N0-NATIVE-ENGINE.md)', () => {
    // @ts-ignore plain-JS web module
    const effects = require('../../../app/veyrnox/_lib/music/beat/beatEffects.js') as { buildEffect: (c: unknown, fx: unknown) => { update: (p: unknown) => void } };

    test('G2: the web distortion effect re-sets the wave shaper curve when drive changes; the library allows one set', () => {
        const { context } = createMockContext();
        const wrapped = wrapNativeContext(context as never, { gaps: [], latencyHint: 'interactive' });
        const effect = effects.buildEffect(wrapped, { type: 'distortion', params: { drive: 10 } });
        effect.update({ drive: 10 }); // unchanged drive: no new curve, fine
        expect(() => effect.update({ drive: 30 })).toThrow('curve already set');
    });

    test('G1: the compressor effect builds an envelope worklet with its initial settings', () => {
        const { context } = createMockContext();
        const wrapped = wrapNativeContext(context as never, { gaps: [], latencyHint: 'interactive' });
        expect(() => effects.buildEffect(wrapped, { type: 'compressor', params: { threshold: -18, ratio: 4 } })).not.toThrow();
        expect(workletNodes.at(-1)?.kind).toBe('workletProcessor');
    });
});

describe('small helpers', () => {
    test('the spike flag is exactly "1"', () => {
        expect(n0Enabled('1')).toBe(true);
        expect(n0Enabled('true')).toBe(false);
        expect(n0Enabled(undefined)).toBe(false);
    });
    test('hermesHeapBytes reads Hermes stats and says null otherwise', () => {
        expect(hermesHeapBytes({ HermesInternal: { getInstrumentedStats: () => ({ js_heapSize: 8_388_608 }) } })).toBe(8_388_608);
        expect(hermesHeapBytes({})).toBeNull();
        expect(hermesHeapBytes({ HermesInternal: { getInstrumentedStats: () => ({}) } })).toBeNull();
    });
});
