// N0 adapter (docs/mobile/spikes/N0-NATIVE-ENGINE.md): lets the shared web beat engine run on react-native-audio-api.
//
// The engine builds its own context with `new (window.AudioContext || window.webkitAudioContext)()` and then only calls
// standard Web Audio methods on it. So the adapter does two things and nothing else:
//   1. wrap the native context so the few things the native library lacks behave (see GAPS), and
//   2. hand that wrapper to `createBeatEngine()` by answering `window.AudioContext` for the length of the call.
// No web code is copied or edited. Anything the native library cannot do is reported in `report.gaps`, never hidden.
import { createBeatEngine as sharedCreateBeatEngine, type BeatEngine, type EngineContext, type ParamLike } from './shared';

export type NativeContextCtor = new (options?: { sampleRate?: number; latencyHint?: 'interactive' | 'balanced' | 'playback' }) => EngineContext;

export type GapKey = 'dynamicsCompressor' | 'connectReturnsVoid';
export type AdapterReport = {
    /** Gaps the adapter papered over. A listed gap means the sound differs from the web page, not that nothing plays. */
    gaps: GapKey[];
    latencyHint: string;
};

type Connectable = { connect?: (destination: unknown, ...rest: unknown[]) => unknown };

// The Web Audio spec makes `a.connect(b)` return `b`, and the engine chains on it everywhere (`osc.connect(gain).connect(out)`).
// The library's docs say connect returns undefined (core/audio-node.mdx), which would throw on the first voice. Patch each node the
// context makes so connect returns its destination; a spec-conforming return value is passed through untouched. Gap G0.
export function chainable<T>(node: T): T {
    const target = node as unknown as Connectable & { __chained?: boolean };
    if (!target || typeof target.connect !== 'function' || target.__chained) return node;
    const original = target.connect;
    Object.defineProperty(target, 'connect', {
        configurable: true, writable: true,
        value(destination: unknown, ...rest: unknown[]) {
            const result = original.call(target, destination, ...rest);
            return result === undefined ? destination : result;
        },
    });
    Object.defineProperty(target, '__chained', { value: true, configurable: true });
    return node;
}

type Params = Record<'threshold' | 'knee' | 'ratio' | 'attack' | 'release', ParamLike>;
function inertParam(value: number): ParamLike {
    return { value,
        setValueAtTime(v) { this.value = v; return this; },
        setTargetAtTime(v) { this.value = v; return this; },
        linearRampToValueAtTime(v) { this.value = v; return this; },
        exponentialRampToValueAtTime(v) { this.value = v; return this; },
        cancelScheduledValues() { return this; },
    };
}

// react-native-audio-api 1.0.1 has no DynamicsCompressorNode (docs: web-audio-api-coverage). The engine builds one on the
// master output (beatOutput.js), in the master limiter (beatMixGraph.js) and in the per-track compressor effect (beatEffects.js).
// Stand-in: a real GainNode, so connect() works, carrying inert parameter objects so `limiter.threshold.value = -1` does not
// throw. It does not compress; the headroom stays in the master gain. This is gap G1 in the audit, and the first thing to hear on a device.
export function passThroughCompressor(context: Record<string, unknown>): unknown {
    const node = chainable((context.createGain as () => Record<string, unknown>).call(context));
    const params: Params = { threshold: inertParam(-24), knee: inertParam(30), ratio: inertParam(12), attack: inertParam(0.003), release: inertParam(0.25) };
    for (const [name, param] of Object.entries(params)) {
        Object.defineProperty(node, name, { value: param, configurable: true });
    }
    Object.defineProperty(node, 'reduction', { value: 0, configurable: true });
    return node;
}

/** Wrap a native context. Methods bind to the real context (native objects need their own `this`); unknown names pass through. */
export function wrapNativeContext(native: EngineContext, report: AdapterReport): EngineContext {
    const gapNote = (key: GapKey) => {
        if (!report.gaps.includes(key)) report.gaps.push(key);
    };
    return new Proxy(native, {
        get(target, prop) {
            if (prop === 'createDynamicsCompressor') {
                return () => {
                    gapNote('dynamicsCompressor');
                    return passThroughCompressor(target as unknown as Record<string, unknown>);
                };
            }
            const value = Reflect.get(target, prop, target);
            if (typeof value !== 'function') return value;
            // Factories that return a node get the chaining patch; createBuffer and createPeriodicWave return plain data.
            const makesNode = typeof prop === 'string' && /^create/.test(prop) && prop !== 'createBuffer' && prop !== 'createPeriodicWave';
            if (!makesNode) return value.bind(target);
            return (...args: unknown[]) => {
                gapNote('connectReturnsVoid');
                return chainable(value.apply(target, args));
            };
        },
    });
}

type WindowLike = { AudioContext?: unknown; webkitAudioContext?: unknown };

/** Run `fn` while `window.AudioContext` answers `make`, then put the old values back. The engine reads it once, at creation. */
export function withWindowAudioContext<T>(make: () => EngineContext, fn: () => T, scope: { window?: WindowLike } = globalThis as { window?: WindowLike }): T {
    const hadWindow = scope.window !== undefined;
    const win: WindowLike = scope.window ?? {};
    const before = { AudioContext: win.AudioContext, webkitAudioContext: win.webkitAudioContext };
    const Provider = function () {
        return make();
    };
    win.AudioContext = Provider;
    win.webkitAudioContext = undefined;
    if (!hadWindow) scope.window = win;
    try {
        return fn();
    } finally {
        win.AudioContext = before.AudioContext;
        win.webkitAudioContext = before.webkitAudioContext;
        if (!hadWindow) delete scope.window;
    }
}

export type NativeBeatEngine = { engine: BeatEngine; report: AdapterReport };

export type CreateOptions = {
    Context: NativeContextCtor;
    latencyHint?: 'interactive' | 'balanced' | 'playback';
    createEngine?: () => BeatEngine;
    scope?: { window?: WindowLike };
};

/** Build the shared beat engine on a native context. `Context` is the library's AudioContext class (injected so tests need no native code). */
export function createNativeBeatEngine({ Context, latencyHint = 'interactive', createEngine = sharedCreateBeatEngine, scope }: CreateOptions): NativeBeatEngine {
    const report: AdapterReport = { gaps: [], latencyHint };
    const make = () => wrapNativeContext(new Context({ latencyHint }), report);
    const engine = withWindowAudioContext(make, createEngine, scope);
    return { engine, report };
}

/** The library, loaded on first use so a screen that never makes sound (and every Jest run) never touches native code. */
export function loadNativeContext(): NativeContextCtor {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate lazy load of the native module
    const lib = require('react-native-audio-api') as { AudioContext: NativeContextCtor };
    return lib.AudioContext;
}
