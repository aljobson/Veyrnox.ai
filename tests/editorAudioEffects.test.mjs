import test from 'node:test';
import assert from 'node:assert/strict';
import { AUDIO_EFFECT_DEFAULTS, audioEffectsProblem, audioEffectsWorkingBytes } from '../app/veyrnox/_lib/editorAudioEffects.mjs';
import { mixAudio, SAMPLE_RATE } from '../app/veyrnox/_lib/editorAudio.mjs';
import { AUDIO_DEFAULTS } from '../app/veyrnox/_lib/editorAudioSettings.mjs';
import { emptySequence, addSequenceMedia, addSequenceClip, updateSequenceClip, reverseSequenceClip, insertSequenceFreeze } from '../app/veyrnox/_lib/editorSequence.mjs';
import { validateSequence } from '../app/veyrnox/_lib/editorSequenceValidation.mjs';
const settings = patch => ({ ...AUDIO_EFFECT_DEFAULTS, ...patch });
const signal = () => new AbortController().signal;
const buffer = (channels, length, sampleRate) => ({ length, numberOfChannels: channels, sampleRate, duration: length / sampleRate, data: Array.from({ length: channels }, () => new Float32Array(length)), getChannelData(ch) { return this.data[ch]; }, copyToChannel(data, ch) { this.data[ch].set(data); } });
class Param {
    value = 1; events = []; incoming = [];
    setValueAtTime(value, time) { this.events.push({ value, time, ramp: false }); }
    linearRampToValueAtTime(value, time) { this.events.push({ value, time, ramp: true }); }
    at(time) { let last = { value: this.value, time: 0 }; for (const event of this.events) { if (time < event.time) return event.ramp ? last.value + (event.value - last.value) * (time - last.time) / (event.time - last.time) : last.value; last = event; } return last.value; }
}
// Deterministic graph probe: stereo routing, oscillation, finite delays, gains, source mapping and fades.
// Browser oscillator/filter implementations and perceptual quality still need actual browser verification.
class GraphContext {
    static all = [];
    constructor(channels, length, sampleRate) { Object.assign(this, { channels, length, sampleRate }); this.destination = this.node('destination'); GraphContext.all.push(this); }
    node(kind) { return { kind, incoming: [], connect(target, output = 0, input = 0) { target.incoming.push({ source: this, output, input }); } }; }
    createBuffer(...args) { return buffer(...args); }
    createGain() { return { ...this.node('gain'), gain: new Param() }; }
    createBiquadFilter() { return { ...this.node('passthrough'), frequency: new Param(), gain: new Param() }; }
    createStereoPanner() { return { ...this.node('passthrough'), pan: new Param() }; }
    createChannelSplitter() { return this.node('splitter'); }
    createChannelMerger() { return this.node('merger'); }
    createDelay(maxDelay) { return { ...this.node('delay'), delayTime: new Param(), maxDelay }; }
    createPeriodicWave(real, imaginary, options) { assert.equal(options.disableNormalization, true); return { real, imaginary }; }
    createOscillator() { return { ...this.node('oscillator'), frequency: new Param(), setPeriodicWave(wave) { this.wave = wave; }, start(time) { this.when = time; }, stop(time) { this.until = time; } }; }
    createBufferSource() { return { ...this.node('source'), playbackRate: new Param(), start(time, offset = 0) { assert.ok(time >= 0); this.when = time; this.offset = offset; }, stop(time) { this.until = time; } }; }
    async startRendering() {
        const cache = new Map(), silent = () => new Float32Array(this.length);
        const sum = (node, channels) => {
            const incoming = node.incoming.map(edge => read(edge.source, edge.output));
            const count = channels || Math.max(1, ...incoming.map(data => data.length)), out = Array.from({ length: count }, silent);
            for (const data of incoming) for (let ch = 0; ch < count; ch++) { const source = data[Math.min(ch, data.length - 1)]; for (let n = 0; n < this.length; n++) out[ch][n] += source[n]; }
            return out;
        };
        const read = (node, port = 0) => {
            let ports = cache.get(node); if (ports?.has(port)) return ports.get(port);
            if (!ports) { ports = new Map(); cache.set(node, ports); }
            let out;
            if (node.kind === 'source') {
                out = Array.from({ length: node.buffer.numberOfChannels }, silent);
                for (let n = Math.round(node.when * this.sampleRate); n < Math.min(this.length, Math.round(node.until * this.sampleRate)); n++) {
                    const at = Math.round(((n / this.sampleRate - node.when) * node.playbackRate.value + node.offset) * node.buffer.sampleRate);
                    if (at < node.buffer.length) for (let ch = 0; ch < out.length; ch++) out[ch][n] = node.buffer.getChannelData(ch)[at];
                }
            } else if (node.kind === 'oscillator') {
                out = [silent()];
                for (let n = Math.round(node.when * this.sampleRate); n < Math.min(this.length, Math.round(node.until * this.sampleRate)); n++) { const phase = 2 * Math.PI * node.frequency.value * (n / this.sampleRate - node.when); out[0][n] = node.wave.real[1] * Math.cos(phase) + node.wave.imaginary[1] * Math.sin(phase); }
            } else if (node.kind === 'splitter') {
                const input = sum(node); out = [input[port] || silent()];
            } else if (node.kind === 'merger') {
                out = [silent(), silent()];
                for (const edge of node.incoming) { const data = read(edge.source, edge.output)[0]; for (let n = 0; n < this.length; n++) out[edge.input][n] += data[n]; }
            } else {
                out = sum(node, node.channelCountMode === 'explicit' ? node.channelCount : node.kind === 'destination' ? this.channels : undefined);
                if (node.kind === 'gain') {
                    const modulation = node.gain.incoming.map(edge => read(edge.source, edge.output)[0]);
                    for (let n = 0; n < this.length; n++) { const gain = node.gain.at(n / this.sampleRate) + modulation.reduce((total, data) => total + data[n], 0); for (const channel of out) channel[n] *= gain; }
                } else if (node.kind === 'delay') {
                    const delay = Math.round(node.delayTime.value * this.sampleRate); assert.ok(node.delayTime.value <= node.maxDelay); out = out.map(channel => { const delayed = silent(); if (delay < this.length) delayed.set(channel.subarray(0, this.length - delay), delay); return delayed; });
                }
            }
            ports.set(port, out); return out;
        };
        const result = this.createBuffer(this.channels, this.length, this.sampleRate); read(this.destination).forEach((data, ch) => result.copyToChannel(data, ch)); return result;
    }
}
class Sink {
    static requests = [];
    constructor(track) { this.track = track; }
    async *buffers(from, to) { assert.ok(to > from); Sink.requests.push([from, to]); const start = Math.max(0, Math.floor(from * SAMPLE_RATE)), end = Math.min(this.track.samples[0].length, Math.ceil(to * SAMPLE_RATE)), out = buffer(this.track.samples.length, end - start, SAMPLE_RATE); this.track.samples.forEach((data, ch) => out.copyToChannel(data.subarray(start, end), ch)); yield { timestamp: start / SAMPLE_RATE, buffer: out }; }
}
const fixture = options => { const media = addSequenceMedia(emptySequence(), { id: 'sound', kind: 'audio', frames: 120, name: 'Original', width: 0, height: 0, hasAudio: true }); return addSequenceClip(media, 'audio', 'sound', { len: 60, ...options }); };
const inputs = samples => new Map([['sound', { async getPrimaryAudioTrack() { return { samples }; } }]]);
const constant = (value, seconds = 3) => new Float32Array(seconds * SAMPLE_RATE).fill(value);
async function render(timeline, samples, options = {}) { const { startFrame = 0, endFrame = 60 } = options; return mixAudio(timeline, inputs(samples), (endFrame - startFrame) / 30 * SAMPLE_RATE, signal(), { ...options, BufferSink: Sink }); }
async function context(run) { const prior = globalThis.OfflineAudioContext; globalThis.OfflineAudioContext = GraphContext; try { await run(); } finally { if (prior === undefined) delete globalThis.OfflineAudioContext; else globalThis.OfflineAudioContext = prior; } }
function close(actual, expected, tolerance = 2e-6) { assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`); }
function sameWindow(actual, full, offset) { for (let ch = 0; ch < 2; ch++) for (let n = 0; n < actual.length; n++) close(actual.getChannelData(ch)[n], full.getChannelData(ch)[offset + n]); }

test('effects reject malformed values, excessive echoes, silent sources and locked changes atomically', () => {
    const tl = fixture({ pan: .4, eq: { low: 3, mid: 0, high: -1 }, audioProcessing: { ...AUDIO_DEFAULTS, gateDb: -30 } }), original = JSON.stringify(tl);
    for (const value of [null, [], settings({ width: NaN }), settings({ tremoloRate: Infinity }), settings({ tremoloDepth: 1.01 }), settings({ echoMix: -1 }), settings({ echoDecay: 0 }), settings({ echoRepeats: 2.5 }), settings({ echoRepeats: 8, echoDelay: 1 }), { ...settings({}), secret: new Array(10000).fill(1) }, { width: 1 }]) assert.ok(updateSequenceClip(tl, 'audio', tl.audio[0].id, { audioEffects: value }).error);
    assert.equal(JSON.stringify(tl), original);
    const applied = updateSequenceClip(tl, 'audio', tl.audio[0].id, { audioEffects: settings({ echoMix: .3 }) }); assert.equal(validateSequence(JSON.parse(JSON.stringify(applied))), null); assert.deepEqual(applied.audio[0].audioProcessing, tl.audio[0].audioProcessing); assert.deepEqual(applied.audio[0].eq, tl.audio[0].eq); assert.equal(applied.audio[0].pan, .4);
    const locked = { ...tl, tracks: tl.tracks.map(track => track.kind === 'audio' ? { ...track, locked: true } : track) }; assert.match(updateSequenceClip(locked, 'audio', tl.audio[0].id, { audioEffects: settings({ width: 0 }) }).error, /Unlock/);
    const silent = { ...applied, media: { sound: { ...applied.media.sound, hasAudio: false } } }; assert.match(validateSequence(silent), /source with sound/);
    const video = { ...applied, media: { sound: { ...applied.media.sound, kind: 'video', width: 640, height: 360 } }, video: [{ ...applied.audio[0], id: 'v1', trackId: 'video-0', transition: 0 }], audio: [] }, frozen = insertSequenceFreeze(video, 'v1', 30, 30); assert.equal(validateSequence(frozen), null); assert.equal(frozen.video.find(clip => clip.freezeFrame !== undefined).volume, 0); assert.deepEqual(frozen.video.find(clip => clip.freezeFrame !== undefined).audioEffects, applied.audio[0].audioEffects);
    assert.equal(audioEffectsProblem(undefined), null); assert.equal(audioEffectsWorkingBytes(settings({})), 0); assert.ok(audioEffectsWorkingBytes(settings({ echoMix: 1, echoDelay: .5, echoRepeats: 8 })) > 10 * 1024 * 1024);
});
test('mid/side width combines stereo into mono, widens channel difference and preserves mono recordings', () => context(async () => {
    const mono = await render(fixture({ audioEffects: settings({ width: 0 }) }), [constant(.4), constant(0)]); close(mono.getChannelData(0)[100], .2); close(mono.getChannelData(1)[100], .2);
    const wide = await render(fixture({ audioEffects: settings({ width: 2 }) }), [constant(.4), constant(0)]); close(wide.getChannelData(0)[100], .6); close(wide.getChannelData(1)[100], -.2);
    const centered = await render(fixture({ audioEffects: settings({ width: 2 }) }), [constant(.2)]); close(centered.getChannelData(0)[100], .2); close(centered.getChannelData(1)[100], .2);
    const neutral = await render(fixture({ audioEffects: settings({}) }), [constant(.4), constant(.1)]); close(neutral.getChannelData(0)[100], .4); close(neutral.getChannelData(1)[100], .1);
}));
test('tremolo gain reaches the declared depth and its phase continues in bounded windows', () => context(async () => {
    const extremes = await render(fixture({ audioEffects: settings({ tremoloDepth: 1, tremoloRate: 5 }) }), [constant(.25)]); close(extremes.getChannelData(0)[0], .125); close(extremes.getChannelData(0)[SAMPLE_RATE * .05], .25); close(extremes.getChannelData(0)[SAMPLE_RATE * .15], 0);
    const tl = fixture({ audioEffects: settings({ tremoloDepth: .7, tremoloRate: 3.7 }) }), full = await render(tl, [constant(.25)]), selected = await render(tl, [constant(.25)], { startFrame: 15, endFrame: 45 }); sameWindow(selected, full, SAMPLE_RATE / 2); assert.equal(GraphContext.all.at(-1).length, SAMPLE_RATE);
}));
test('echo uses exactly the chosen finite taps, normalizes the wet blend and stops at the clip boundary', () => context(async () => {
    const samples = constant(0); samples[SAMPLE_RATE / 10] = .4;
    const s = settings({ echoMix: .5, echoRepeats: 3, echoDelay: .2, echoDecay: .5 }), tl = fixture({ audioEffects: s }), result = await render(tl, [samples]);
    close(result.getChannelData(0)[SAMPLE_RATE * .1], .2); close(result.getChannelData(0)[SAMPLE_RATE * .3], .2 * 4 / 7); close(result.getChannelData(0)[SAMPLE_RATE * .5], .2 * 2 / 7); close(result.getChannelData(0)[SAMPLE_RATE * .7], .2 / 7); close(result.getChannelData(0)[SAMPLE_RATE * .9], 0);
    const last = constant(0); last[Math.round(SAMPLE_RATE * .9)] = .4; const clipped = await render(fixture({ len: 30, audioEffects: s }), [last]); close(clipped.getChannelData(0)[Math.round(SAMPLE_RATE * 1.1)], 0); assert.equal(clipped.length, 2 * SAMPLE_RATE);
}));
test('effect windows preserve original echo history, reverse/rate mapping, gate state and overlapping fades', () => context(async () => {
    const effects = settings({ width: 1.3, tremoloDepth: .6, tremoloRate: 4.3, echoMix: .3, echoDelay: .1, echoDecay: .6, echoRepeats: 3 });
    let tl = fixture({ rate: 1.2, fadeIn: 45, fadeOut: 45, volume: .5, audioEffects: effects, audioProcessing: { ...AUDIO_DEFAULTS, gateDb: -25, voice: 'robot' } }); tl = reverseSequenceClip(tl, 'audio', tl.audio[0].id);
    const source = Float32Array.from({ length: 3 * SAMPLE_RATE }, (_, n) => (n < SAMPLE_RATE * 1.4 ? .3 : .001) * Math.sin(n / 13)), full = await render(tl, [source]), selected = await render(tl, [source], { startFrame: 15, endFrame: 45 }); sameWindow(selected, full, SAMPLE_RATE / 2); assert.ok(GraphContext.all.at(-1).length >= SAMPLE_RATE * 1.3 && GraphContext.all.at(-1).length <= SAMPLE_RATE * 1.3 + 2, 'echo retains only the bounded tap history');
    Sink.requests = []; const dry = fixture({ audioEffects: settings({ echoMix: .4 }) }); const complete = await render(dry, [source]), bounded = await render(dry, [source], { startFrame: 30, endFrame: 60 }); sameWindow(bounded, complete, SAMPLE_RATE); close(Sink.requests.at(-1)[0], .4, 3 / SAMPLE_RATE); assert.equal(Sink.requests.at(-1)[1], 2);
}));
test('direct mixer use refuses malformed effect graphs before context allocation', () => context(async () => {
    const before = GraphContext.all.length, tl = fixture({}); tl.audio[0].audioEffects = settings({ echoRepeats: 10000 }); await assert.rejects(render(tl, [constant(.2)]), /supported range/); assert.equal(GraphContext.all.length, before);
}));

test('long echo selections decode only the finite tap history and effect memory is checked before allocation', () => context(async () => {
    const effects = settings({ echoMix: .4 }), base = fixture({ audioEffects: effects }), long = { ...base, media: { sound: { ...base.media.sound, frames: 18030 } }, audio: [{ ...base.audio[0], len: 18000 }] }, ranges = [];
    class VirtualSink {
        async *buffers(from, to) { ranges.push([from, to]); const first = Math.floor(from * SAMPLE_RATE), last = Math.ceil(to * SAMPLE_RATE), data = buffer(1, last - first, SAMPLE_RATE); data.getChannelData(0).fill(.2); yield { timestamp: first / SAMPLE_RATE, buffer: data }; }
    }
    const selected = await mixAudio(long, inputs([]), SAMPLE_RATE, signal(), { startFrame: 15000, endFrame: 15030, BufferSink: VirtualSink });
    assert.equal(selected.length, SAMPLE_RATE); close(selected.getChannelData(0)[100], .2); assert.ok(GraphContext.all.at(-1).length <= 1.6 * SAMPLE_RATE + 2); close(ranges[0][0], 499.4, 3 / SAMPLE_RATE); assert.equal(ranges[0][1], 501);
    const large = { ...long, audio: Array.from({ length: 40 }, (_, i) => ({ ...long.audio[0], id: `a${i + 1}`, audioEffects: settings({ echoMix: 1, echoDelay: .5, echoRepeats: 8 }) })) }, contexts = GraphContext.all.length;
    await assert.rejects(mixAudio(large, inputs([]), 600 * SAMPLE_RATE, signal(), { BufferSink: VirtualSink }), /memory budget/); assert.equal(GraphContext.all.length, contexts);
}));
