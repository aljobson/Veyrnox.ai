// PCM, frame-major interleaving; the same truncating quantiser serves every path.
export function createWavWriter({ channels: count, sampleRate, bitDepth = 16, frames }) {
  const width = bitDepth / 8, bytes = frames * count * width;
  if (![1, 2].includes(count) || ![16, 24].includes(bitDepth) || !Number.isSafeInteger(frames) || frames < 0
    || !Number.isInteger(sampleRate) || sampleRate < 1 || sampleRate > 192000 || bytes > 0xffffffff - 37) {
    throw new RangeError('Invalid WAV channels or sample rate.');
  }
  const buffer = new ArrayBuffer(44 + bytes + (bytes % 2)), view = new DataView(buffer);
  const text = (at, value) => { for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, count, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * count * width, true);
  view.setUint16(32, count * width, true); view.setUint16(34, bitDepth, true); text(36, 'data'); view.setUint32(40, bytes, true);
  return {
    write(channels, frameOffset = 0) {
      if (!Array.isArray(channels) || channels.length !== count || !Number.isSafeInteger(frameOffset) || frameOffset < 0
        || !channels.every(c => c instanceof Float32Array && c.length === channels[0].length)
        || frameOffset + channels[0].length > frames) throw new RangeError('Invalid WAV window.');
      for (let frame = 0; frame < channels[0].length; frame++) for (let channel = 0; channel < count; channel++) {
        const raw = channels[channel][frame];
        const sample = Number.isNaN(raw) ? 0 : Math.max(-1, Math.min(1, raw));
        const value = Math.trunc(sample * (sample < 0 ? 2 ** (bitDepth - 1) : 2 ** (bitDepth - 1) - 1));
        const at = 44 + ((frameOffset + frame) * count + channel) * width;
        if (bitDepth === 16) view.setInt16(at, value, true);
        else { view.setUint8(at, value & 255); view.setUint8(at + 1, (value >> 8) & 255); view.setUint8(at + 2, (value >> 16) & 255); }
      }
    },
    finish: () => buffer,
  };
}
export function encodeWavChannels(channels, sampleRate, bitDepth = 16) {
  const writer = createWavWriter({ channels: channels?.length, frames: channels?.[0]?.length, sampleRate, bitDepth });
  writer.write(channels, 0);
  return writer.finish();
}
