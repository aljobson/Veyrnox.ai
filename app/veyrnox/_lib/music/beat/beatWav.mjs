// 16-bit PCM, frame-major interleaving. Accepts mono or stereo channel arrays.
export function encodeWavChannels(channels, sampleRate) {
  if (!Array.isArray(channels) || ![1, 2].includes(channels.length) ||
    !channels.every((channel) => channel instanceof Float32Array && channel.length === channels[0].length) ||
    !Number.isInteger(sampleRate) || sampleRate < 1 || sampleRate > 192000) throw new RangeError('Invalid WAV channels or sample rate.');
  const count = channels.length, frames = channels[0].length, bytes = frames * count * 2;
  const buffer = new ArrayBuffer(44 + bytes);
  const view = new DataView(buffer);
  const text = (at, value) => { for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, 36 + bytes, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, count, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * count * 2, true);
  view.setUint16(32, count * 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, bytes, true);
  for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < count; channel++) {
    const raw = channels[channel][frame];
    const sample = Number.isNaN(raw) ? 0 : Math.max(-1, Math.min(1, raw));
    view.setInt16(44 + (frame * count + channel) * 2, sample * (sample < 0 ? 32768 : 32767), true);
  }
  return buffer;
}
