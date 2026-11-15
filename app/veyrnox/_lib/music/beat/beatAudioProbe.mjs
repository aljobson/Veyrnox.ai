const ascii = (b, at, text) => [...text].every((c, i) => b[at + i] === c.charCodeAt(0));
export function probeAudioHeader(input, totalBytes) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const unknown = { container: 'unknown', channels: null, sampleRate: null, durationSec: null };
  if (b.length < 12) return unknown;
  if (ascii(b, 0, 'OggS')) return { ...unknown, container: 'ogg' };
  if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WAVE')) {
    let channels, sampleRate, align;
    for (let at = 12; at + 8 <= b.length;) {
      const size = v.getUint32(at + 4, true);
      if (ascii(b, at, 'fmt ') && size >= 16 && at + 24 <= b.length) {
        channels = v.getUint16(at + 10, true); sampleRate = v.getUint32(at + 12, true); align = v.getUint16(at + 20, true);
      }
      if (ascii(b, at, 'data') && channels && sampleRate && align && at + 8 + size <= totalBytes) {
        return { container: 'wav', channels, sampleRate, durationSec: size / align / sampleRate };
      }
      at += 8 + size + (size % 2);
      if (at + 8 > b.length && at + 8 <= totalBytes) {
        return { ...unknown, container: 'wav', needsFullHeader: true };
      }
    }
    return unknown;
  }
  if (ascii(b, 0, 'fLaC') && b.length >= 42 && (b[4] & 127) === 0) {
    const rate = (b[18] << 12) | (b[19] << 4) | (b[20] >> 4);
    const channels = ((b[20] >> 1) & 7) + 1;
    const samples = (b[21] & 15) * 2 ** 32 + v.getUint32(22);
    return { container: 'flac', channels, sampleRate: rate, durationSec: rate && samples ? samples / rate : null };
  }
  let at = 0;
  if (ascii(b, 0, 'ID3')) {
    if ((b[6] | b[7] | b[8] | b[9]) & 128) return unknown;
    at = 10 + (b[6] << 21 | b[7] << 14 | b[8] << 7 | b[9]);
    if (at + 4 > b.length && at + 4 <= totalBytes) return { ...unknown, container: 'mp3', needsFullHeader: true };
  }
  for (; at + 4 <= b.length; at++) {
    if (b[at] !== 255 || (b[at + 1] & 224) !== 224 || ((b[at + 1] >> 1) & 3) !== 1) continue;
    const version = (b[at + 1] >> 3) & 3, index = b[at + 2] >> 4;
    const rate = [44100, 48000, 32000][(b[at + 2] >> 2) & 3] / (version === 3 ? 1 : version === 2 ? 2 : 4);
    if (version === 1 || !rate || !index || index === 15) continue;
    const channels = (b[at + 3] >> 6) === 3 ? 1 : 2;
    const side = version === 3 ? (channels === 1 ? 17 : 32) : (channels === 1 ? 9 : 17);
    const xing = at + 4 + ((b[at + 1] & 1) ? 0 : 2) + side;
    let count = null;
    if (xing + 12 <= b.length && (ascii(b, xing, 'Xing') || ascii(b, xing, 'Info')) && (v.getUint32(xing + 4) & 1)) count = v.getUint32(xing + 8);
    const vbri = at + 36;
    if (vbri + 18 <= b.length && ascii(b, vbri, 'VBRI')) count = v.getUint32(vbri + 14);
    return { container: 'mp3', channels, sampleRate: rate, durationSec: null,
      hintDurationSec: count ? count * (version === 3 ? 1152 : 576) / rate : null };
  }
  return unknown;
}
export function admitProbe(probe) {
  if (probe.container === 'ogg') throw new Error('Unsupported audio format (Ogg)');
  if (!['wav', 'flac', 'mp3'].includes(probe.container)) throw new Error('Unsupported audio format');
  if (![1, 2].includes(probe.channels)) throw new Error(`Unsupported audio layout (${probe.channels} channels)`);
  if (!(probe.sampleRate > 0)) throw new Error('Unsupported sample rate');
  if (probe.container !== 'mp3' && !(probe.durationSec > 0)) throw new Error('Audio duration is unknown');
}
