import { AUDIO_RATE } from './beatAudioRules.mjs';
import { seededRandom } from './beatSeed.mjs';
import { REVERB_SIZES } from './beatMixRules.mjs';
export const EFFECT_UNAVAILABLE = "This effect isn't available in this browser";
const impulses = new Map(), buffers = new WeakMap();
export const impulseSeed = size => (0x726f6f6d ^ Math.round(size * 1000)) >>> 0;
export function canonicalImpulse(size) {
  if (!REVERB_SIZES.includes(size)) throw new Error('Invalid room size.');
  if (!impulses.has(size)) {
    const random = seededRandom(impulseSeed(size)), length = Math.floor(AUDIO_RATE * size);
    impulses.set(size, Array.from({ length: 2 }, () => Float32Array.from({ length }, (_, i) =>
      (random() * 2 - 1) * (1 - i / length) ** 2.5)));
  }
  return impulses.get(size);
}
export function resampleImpulse(data, rate) {
  if (rate === AUDIO_RATE) return data.slice();
  return Float32Array.from({ length: Math.floor(data.length * rate / AUDIO_RATE) }, (_, i) => {
    const position = i * AUDIO_RATE / rate, left = Math.floor(position), fraction = position - left;
    return data[left] + ((data[left + 1] ?? 0) - data[left]) * fraction;
  });
}
export function roomImpulse(context, size) {
  if (!buffers.has(context)) buffers.set(context, new Map());
  const cache = buffers.get(context);
  if (!cache.has(size)) {
    const data = canonicalImpulse(size).map(channel => resampleImpulse(channel, context.sampleRate));
    const buffer = context.createBuffer(2, data[0].length, context.sampleRate);
    for (let ch = 0; ch < 2; ch++) buffer.getChannelData(ch).set(data[ch]);
    cache.set(size, buffer);
  }
  return cache.get(size);
}
export function distortionCurve(drive) {
  return Float32Array.from({ length: 1024 }, (_, i) => {
    const x = i * 2 / 1023 - 1;
    return drive ? ((3 + drive) * x * 20 * (Math.PI / 180)) / (Math.PI + drive * Math.abs(x)) : x;
  });
}
// Only changed targets are smoothed; polling never restarts an existing target.
export function parameterWriter() {
  const values = new Map();
  return (param, value, now) => {
    if (values.get(param) === value) return;
    if (now === undefined) param.value = value;
    else param.setTargetAtTime(value, now, 0.01);
    values.set(param, value);
  };
}
export function buildEffect(context, fx) {
  const nodes = [], write = parameterWriter();
  const node = method => { const n = context[method](); nodes.push(n); return n; };
  let input, output, apply;
  try {
    if (fx.type === 'eq') {
      const bands = ['lowshelf', 'peaking', 'highshelf'].map((type, i) => {
        const n = node('createBiquadFilter'); n.type = type; n.frequency.value = [200, 1200, 5000][i]; n.Q.value = 0.9; return n;
      });
      bands[0].connect(bands[1]).connect(bands[2]); [input, , output] = bands;
      apply = (p, now) => ['low', 'mid', 'high'].forEach((k, i) => write(bands[i].gain, p[k], now));
    } else if (fx.type === 'compressor') {
      input = output = node('createDynamicsCompressor');
      apply = (p, now) => { write(input.threshold, p.threshold, now); write(input.ratio, p.ratio, now); };
    } else if (fx.type === 'distortion') {
      input = output = node('createWaveShaper'); input.oversample = '2x'; let drive;
      apply = p => { if (drive !== p.drive) { input.curve = distortionCurve(p.drive); drive = p.drive; } };
    } else {
      input = node('createGain'); output = node('createGain');
      const dry = node('createGain'), wet = node('createGain');
      const processor = node(fx.type === 'delay' ? 'createDelay' : 'createConvolver');
      input.connect(dry).connect(output); input.connect(processor).connect(wet).connect(output);
      let feedback;
      if (fx.type === 'delay') { feedback = node('createGain'); processor.connect(feedback).connect(processor); }
      else processor.buffer = roomImpulse(context, fx.params.size);
      apply = (p, now) => {
        write(dry.gain, 1 - p.mix, now); write(wet.gain, p.mix, now);
        if (feedback) { write(processor.delayTime, p.time, now); write(feedback.gain, p.feedback, now); }
      };
    }
    apply(fx.params);
    return { input, output, nodes, update: apply };
  } catch (cause) {
    nodes.forEach(n => n.disconnect());
    throw new Error(EFFECT_UNAVAILABLE, { cause });
  }
}
