// A stand-in for react-native-audio-api's AudioContext that supports exactly what the library documents
// (docs/other/web-audio-api-coverage.mdx, 1.0.1) and nothing more: no DynamicsCompressorNode, a WaveShaper curve
// that can be set once. It records every node kind the engine asks for, so a test can prove coverage without a device.
export type Mock = ReturnType<typeof createMockContext>;

const param = (value = 0) => ({
    value,
    setValueAtTime: jest.fn(), linearRampToValueAtTime: jest.fn(), exponentialRampToValueAtTime: jest.fn(),
    setTargetAtTime: jest.fn(), cancelScheduledValues: jest.fn(), cancelAndHoldAtTime: jest.fn(),
});

export function createMockContext() {
    const created: string[] = [];
    const nodes: Record<string, unknown>[] = [];
    let curveSet = false;
    const make = (kind: string, extra: Record<string, unknown> = {}) => {
        created.push(kind);
        const node: Record<string, unknown> = {
            kind,
            // The library's docs say connect returns undefined; the adapter must make chaining work anyway.
            connect: jest.fn(),
            disconnect: jest.fn(),
            start: undefined, stop: undefined, onended: null,
            ...extra,
        };
        nodes.push(node);
        return node;
    };
    const source = (kind: string, extra: Record<string, unknown> = {}) =>
        make(kind, { start: jest.fn(), stop: jest.fn(function (this: { onended?: () => void }) { /* ended callback is driven by tests */ }), ...extra });
    const context = {
        currentTime: 0, sampleRate: 48000, state: 'suspended', destination: { kind: 'destination' },
        baseLatency: 0.005, outputLatency: 0.02,
        resume: jest.fn(async () => { context.state = 'running'; }),
        close: jest.fn(async () => { context.state = 'closed'; }),
        createGain: () => make('gain', { gain: param(1) }),
        createOscillator: () => source('oscillator', { frequency: param(440), detune: param(0), type: 'sine', setPeriodicWave: jest.fn() }),
        createBiquadFilter: () => make('biquad', { frequency: param(350), Q: param(1), gain: param(0), type: 'lowpass' }),
        createBufferSource: () => source('bufferSource', { buffer: null, loop: false, playbackRate: param(1) }),
        createBuffer: (channels: number, length: number) => { created.push('buffer'); return { numberOfChannels: channels, length, getChannelData: () => new Float32Array(length) }; },
        createDelay: () => make('delay', { delayTime: param(0) }),
        createStereoPanner: () => make('stereoPanner', { pan: param(0) }),
        createConvolver: () => make('convolver', { buffer: null }),
        createPeriodicWave: () => { created.push('periodicWave'); return { kind: 'periodicWave' }; },
        createWaveShaper: () => {
            const node = make('waveShaper', { oversample: 'none' });
            let curve: unknown = null;
            Object.defineProperty(node, 'curve', {
                get: () => curve,
                set: (value) => { if (curveSet && curve !== null) throw new Error('InvalidStateError: curve already set'); curve = value; curveSet = true; },
            });
            curveSet = false;
            return node;
        },
    };
    return { context, created, nodes };
}

/** Constructor shaped like the library's AudioContext, returning a fresh mock each time (the last one is in `last`). */
export function mockAudioContextClass() {
    const state: { last: Mock | null; options: unknown[] } = { last: null, options: [] };
    const Ctor = function (options?: unknown) {
        state.options.push(options);
        state.last = createMockContext();
        return state.last.context;
    } as unknown as new (options?: unknown) => never;
    return { Ctor, state };
}
