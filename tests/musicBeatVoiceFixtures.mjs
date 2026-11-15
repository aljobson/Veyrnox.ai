export function audioMock({ cancelAndHold = true } = {}) {
  const nodes = [], calls = [];
  const param = (name) => {
    const p = { value: 1, calls: [] };
    for (const method of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime', 'cancelScheduledValues', 'cancelAndHoldAtTime']) p[method] = (...args) => { p.calls.push([method, ...args]); calls.push([name, method, ...args]); };
    if (!cancelAndHold) delete p.cancelAndHoldAtTime;
    return p;
  };
  const context = { currentTime: 0, sampleRate: 44100, destination: {}, nodes, calls,
    createPeriodicWave: () => ({}), createBuffer: (channels, frames) => ({ getChannelData: () => new Float32Array(frames) }),
    startRendering: async () => ({ sampleRate: 44100, getChannelData: () => new Float32Array(8) }),
  };
  for (const kind of ['Gain', 'Oscillator', 'BiquadFilter', 'BufferSource', 'Delay', 'WaveShaper', 'StereoPanner', 'DynamicsCompressor']) context[`create${kind}`] = () => {
    const n = { kind, gain: param('gain'), frequency: param('frequency'), Q: param('Q'), delayTime: param('delayTime'), pan: param('pan'), connections: [], stops: [],
      connect(out) { this.connections.push(out); return out; }, disconnect() { this.disconnected = true; }, setPeriodicWave() {},
    };
    if (['Oscillator', 'BufferSource'].includes(kind)) { n.start = (at) => { n.startedAt = at; }; n.stop = (at) => n.stops.push(at); }
    nodes.push(n); return n;
  };
  return context;
}
