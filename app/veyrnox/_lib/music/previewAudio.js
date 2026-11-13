const urls = new Map();

function hashText(value) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function writeAscii(view, offset, text) {
  for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
}

function previewWav(seed) {
  const sampleRate = 8000;
  const seconds = 8;
  const samples = sampleRate * seconds;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  writeAscii(view, 8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, samples * 2, true);

  const hash = hashText(seed);
  const root = 98 + (hash % 65);
  for (let index = 0; index < samples; index += 1) {
    const time = index / sampleRate;
    const beat = Math.floor(time * 2) % 4;
    const tone = root * [1, 1.25, 1.5, 1.125][beat];
    const envelope = Math.min(1, (time % 0.5) * 12) * Math.min(1, (0.5 - (time % 0.5)) * 5);
    const sample = (
      Math.sin(2 * Math.PI * tone * time) * 0.42 +
      Math.sin(2 * Math.PI * tone * 2 * time) * 0.12 +
      Math.sin(2 * Math.PI * (root / 2) * time) * 0.2
    ) * envelope;
    view.setInt16(44 + index * 2, Math.max(-1, Math.min(1, sample)) * 32767, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export function musicPreviewAudioUrl(songId) {
  if (!urls.has(songId)) urls.set(songId, URL.createObjectURL(previewWav(songId)));
  return urls.get(songId);
}

export function releaseMusicPreviewAudio(songId) {
  const url = urls.get(songId);
  if (!url) return;
  URL.revokeObjectURL(url);
  urls.delete(songId);
}
