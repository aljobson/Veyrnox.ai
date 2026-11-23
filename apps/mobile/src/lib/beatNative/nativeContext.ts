// N0 adapter (docs/mobile/spikes/N0-NATIVE-ENGINE.md): lets the shared web beat engine run on react-native-audio-api.
//
// The engine builds its own context with `new (window.AudioContext || window.webkitAudioContext)()` and then only calls
// standard Web Audio methods on it. So the adapter does two things and nothing else:
//   1. wrap the native context so the few things the native library lacks behave (see GAPS), and
//   2. hand that wrapper to `createBeatEngine()` by answering `window.AudioContext` for the length of the call.
// No web code is copied or edited. Anything the native library cannot do is reported in `report.gaps`, never hidden.
import { createBeatEngine as sharedCreateBeatEngine, type BeatEngine, type EngineContext, type ParamLike } from './shared';
import { createDynamicsProcessor, type DynamicsSettings } from './dynamicsProcessor';

export type NativeContextCtor = new (options?: { sampleRate?: number; latencyHint?: 'interactive' | 'balanced' | 'playback' }) => EngineContext;

export type GapKey = 'connectReturnsVoid';
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

type DynamicsName = 'threshold' | 'knee' | 'ratio' | 'attack' | 'release';
type Params = Record<DynamicsName, ParamLike>;
function dynamicsParam(initial: number, changed: (value: number) => void): ParamLike {
    let current = initial;
    return {
        get value() { return current; },
        set value(value: number) { if (Number.isFinite(value)) { current = value; changed(value); } },
        setValueAtTime(v) { this.value = v; return this; },
        setTargetAtTime(v) { this.value = v; return this; },
        linearRampToValueAtTime(v) { this.value = v; return this; },
        exponentialRampToValueAtTime(v) { this.value = v; return this; },
        cancelScheduledValues() { return this; },
    };
}

type DynamicsNodeFactory = (context: Record<string, unknown>, settings: DynamicsSettings) => Record<string, unknown>;
const workletDynamicsNode: DynamicsNodeFactory = (context, settings) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate lazy load; screens without sound never initialize worklets
    const { WorkletProcessingNode } = require('react-native-audio-worklets') as {
        WorkletProcessingNode: new (context: unknown, processor: ReturnType<typeof createDynamicsProcessor>) => Record<string, unknown>;
    };
    return new WorkletProcessingNode(context, createDynamicsProcessor(settings, Number(context.sampleRate)));
};

// react-native-audio-api 1.0.1 deliberately exposes custom processing nodes through react-native-audio-worklets rather than
// DynamicsCompressorNode. This is a real stereo-linked, time-domain envelope compressor with 6 ms look-ahead. The same node
// is accepted by AudioContext and OfflineAudioContext. Editable threshold/ratio values are part of the native run key, so a
// changed setting rebuilds a fresh processor instead of attempting unsafe cross-runtime mutation.
export function nativeDynamicsCompressor(context: Record<string, unknown>, initial: DynamicsSettings = {}, makeNode: DynamicsNodeFactory = workletDynamicsNode): unknown {
    const values: Record<DynamicsName, number> = {
        threshold: initial.threshold ?? -24, knee: initial.knee ?? 30, ratio: initial.ratio ?? 12,
        attack: initial.attack ?? 0.003, release: initial.release ?? 0.25,
    };
    const node = chainable(makeNode(context, values));
    const params = {} as Params;
    for (const name of Object.keys(values) as DynamicsName[]) params[name] = dynamicsParam(values[name], value => { values[name] = value; });
    for (const [name, param] of Object.entries(params)) {
        Object.defineProperty(node, name, { value: param, configurable: true });
    }
    Object.defineProperty(node, 'reduction', { get: () => 0, configurable: true });
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
                return (settings?: DynamicsSettings) => {
                    const native = Reflect.get(target, prop, target);
                    if (typeof native === 'function') return chainable(native.call(target, settings));
                    return nativeDynamicsCompressor(target as unknown as Record<string, unknown>, settings);
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

export type NativeOfflineContext = EngineContext & {
    createBuffer(channels: number, length: number, sampleRate: number): import('./exportShared').PCMBuffer;
    startRendering(): Promise<import('./exportShared').PCMBuffer>;
};
export type NativeOfflineCtor = new (channels: number, length: number, sampleRate: number) => NativeOfflineContext;
export class OfflineUnavailable extends Error { constructor() { super('offline_unavailable'); } }
export function loadNativeOfflineContext(): NativeOfflineCtor | null {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- no native import until export opens
        const lib = require('react-native-audio-api') as { OfflineAudioContext?: NativeOfflineCtor };
        return typeof lib.OfflineAudioContext === 'function' ? lib.OfflineAudioContext : null;
    } catch { return null; }
}
type OfflineWindow = { OfflineAudioContext?: unknown; webkitOfflineAudioContext?: unknown };
let offlineQueue: Promise<void> = Promise.resolve();
/** Hold the override across awaits, including buffer loads. Every native export uses this same queue. */
export async function withWindowOfflineContext<T>(Ctor: NativeOfflineCtor | null, report: AdapterReport,
    fn: (make: (channels: number, length: number, rate: number) => NativeOfflineContext) => Promise<T>,
    scope: { window?: OfflineWindow } = globalThis as { window?: OfflineWindow }): Promise<T> {
    const previous = offlineQueue;
    let release!: () => void;
    offlineQueue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    const hadWindow = scope.window !== undefined, win = scope.window ?? {};
    const descriptors = ['OfflineAudioContext', 'webkitOfflineAudioContext'].map(key => Object.getOwnPropertyDescriptor(win, key));
    const make = (channels: number, length: number, rate: number) => {
        if (!Ctor) throw new OfflineUnavailable();
        try { return wrapNativeContext(new Ctor(channels, length, rate), report) as NativeOfflineContext; }
        catch { throw new OfflineUnavailable(); }
    };
    try {
        if (!Ctor) throw new OfflineUnavailable();
        win.OfflineAudioContext = function (channels: number, length: number, rate: number) { return make(channels, length, rate); };
        win.webkitOfflineAudioContext = undefined;
        if (!hadWindow) scope.window = win;
        return await fn(make);
    } finally {
        try {
            ['OfflineAudioContext', 'webkitOfflineAudioContext'].forEach((key, index) => {
                const descriptor = descriptors[index];
                if (descriptor) Object.defineProperty(win, key, descriptor);
                else delete win[key as keyof OfflineWindow];
            });
            if (!hadWindow) delete scope.window;
        } finally { release(); }
    }
}
