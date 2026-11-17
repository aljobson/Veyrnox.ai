/* Same-origin static worklet. Frames use the editor AudioContext clock. */
class BeatCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.samples = new Float32Array(4096); this.used = 0; this.frame = 0;
    this.port.onmessage = ({ data }) => {
      if (data?.type === 'flush') { this.send(); this.port.postMessage({ type: 'flushed', id: data.id }); }
    };
  }
  send() {
    if (!this.used) return;
    const samples = this.samples.slice(0, this.used);
    this.port.postMessage({ frame: this.frame, samples }, [samples.buffer]); this.used = 0;
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.[0]) return true;
    for (let i = 0; i < channels[0].length; i++) {
      if (!this.used) this.frame = currentFrame + i;
      this.samples[this.used++] = channels[1] ? (channels[0][i] + channels[1][i]) / 2 : channels[0][i];
      if (this.used === this.samples.length) this.send();
    }
    return true;
  }
}
registerProcessor('beat-capture', BeatCapture);
