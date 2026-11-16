export class Param {
  value = 1; events = [];
  setValueAtTime(value, time) { this.events.push({ type: 'set', value, time }); }
  linearRampToValueAtTime(value, time) { this.events.push({ type: 'linear', value, time }); }
  exponentialRampToValueAtTime(value, time) { this.events.push({ type: 'exponential', value, time }); }
  setTargetAtTime(value, time, constant) { this.events.push({ type: 'target', value, time, constant }); }
  cancelScheduledValues(time) { this.events = this.events.filter(e => e.time < time); }
  at(time) {
    let previous = { value: this.value, time: 0 };
    for (const event of [...this.events].sort((a, b) => a.time - b.time)) {
      // Treat sub-picosecond arithmetic noise at a seam as simultaneous.
      if (event.time > time + 1e-12) return event.type === 'linear'
        ? previous.value + (event.value - previous.value) * (time - previous.time) / (event.time - previous.time) : previous.value;
      previous = event;
    }
    return previous.value;
  }
}
export class FakeNode {
  constructor(type, context) {
    this.type = type; this.context = context; this.connections = [];
    for (const key of ['gain', 'pan', 'frequency', 'Q', 'threshold', 'knee', 'ratio', 'attack', 'release', 'delayTime', 'playbackRate', 'detune']) this[key] = new Param();
  }
  connect(node) { this.connections.push(node); return node; }
  disconnect() { this.disconnected = true; }
  start(...args) { this.started = args; }
  stop(...args) { this.stopped = args; }
}
export class FakeContext {
  static instances = [];
  constructor(channels = 2, length = 1, rate = 48000) {
    this.sampleRate = rate; this.channels = channels; this.length = length; this.currentTime = 0; this.nodes = [];
    this.destination = new FakeNode('destination', this);
    FakeContext.instances.push(this);
  }
  create(type) { const n = new FakeNode(type, this); this.nodes.push(n); return n; }
  createGain() { return this.create('gain'); }
  createStereoPanner() { return this.create('panner'); }
  createDynamicsCompressor() { return this.create('compressor'); }
  createBiquadFilter() { return this.create('filter'); }
  createConvolver() { return this.create('convolver'); }
  createDelay() { return this.create('delay'); }
  createWaveShaper() { return this.create('shaper'); }
  createOscillator() { return this.create('oscillator'); }
  createBufferSource() { return this.create('source'); }
  createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, sampleRate, length, duration: length / sampleRate, getChannelData: ch => data[ch] };
  }
  async startRendering() { return this.createBuffer(this.channels, this.length, this.sampleRate); }
}
