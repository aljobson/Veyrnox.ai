// Synthetic container headers only: no private provider media or network dependency.
export function flacHeader() {
  const bytes = new Uint8Array(46);
  bytes.set([0x66, 0x4c, 0x61, 0x43, 0x80, 0, 0, 34]);
  bytes.set([0x10, 0, 0x10, 0], 8); // STREAMINFO block sizes: 4096.
  // 48 kHz, stereo, 16 bits, unknown total samples and MD5 (RFC 9639 §8.2).
  bytes.set([0x0b, 0xb8, 0x02, 0xf0], 18);
  bytes.set([0xff, 0xf8, 0x18, 0x18], 42);
  return bytes;
}

export function mp3Frame() {
  const bytes = new Uint8Array(417); // MPEG1 Layer III, 128 kbps, 44.1 kHz.
  bytes.set([0xff, 0xfb, 0x90, 0]);
  return bytes;
}

export function taggedAudio(audio, { size = 13065, version = 4, footer = false } = {}) {
  const bytes = new Uint8Array(10 + size + (footer ? 10 : 0) + audio.length);
  bytes.set([0x49, 0x44, 0x33, version, 0, footer ? 0x10 : 0,
    (size >>> 21) & 127, (size >>> 14) & 127, (size >>> 7) & 127, size & 127]);
  if (footer) bytes.set([0x33, 0x44, 0x49, ...bytes.subarray(3, 10)], 10 + size);
  bytes.set(audio, 10 + size + (footer ? 10 : 0));
  return bytes;
}
