import test from 'node:test';
import assert from 'node:assert/strict';
import { sniffProviderOutputType, PROVIDER_SNIFF_BYTES } from '../lib/providerOutputType.js';
import { sniffType } from '../lib/uploadSource.js';
import { flacHeader, mp3Frame, taggedAudio } from './fixtures/providerAudio.mjs';

test('classifies native and ID3-tagged FLAC, including a matching v2.4 footer', () => {
  for (const body of [flacHeader(), taggedAudio(flacHeader()), taggedAudio(flacHeader(), { footer: true })]) {
    assert.equal(sniffProviderOutputType(body), 'audio/flac');
  }
  assert.equal(sniffType(flacHeader()), null, 'the user-upload allowlist is unchanged');
});

test('ID3 is metadata, not evidence of MP3; only valid post-tag MPEG frames qualify', () => {
  for (const version of [2, 3, 4]) assert.equal(sniffProviderOutputType(taggedAudio(mp3Frame(), { version })), 'audio/mpeg');
  assert.equal(sniffProviderOutputType(mp3Frame()), 'audio/mpeg');
  for (const audio of [new Uint8Array(), new TextEncoder().encode('<html>not audio</html>'), mp3Frame().subarray(0, 4)]) {
    assert.equal(sniffProviderOutputType(taggedAudio(audio)), null);
  }
  for (const [index, value] of [[1, 0xeb], [2, 0xf0], [2, 0x9c], [3, 2]]) {
    const frame = mp3Frame(); frame[index] = value;
    assert.equal(sniffProviderOutputType(taggedAudio(frame)), null);
  }
});

test('rejects malformed, truncated, unsupported or oversized ID3 without searching its contents', () => {
  const valid = taggedAudio(flacHeader());
  for (const length of [3, 9, 10, 13074, 13115]) assert.equal(sniffProviderOutputType(valid.subarray(0, length)), null);
  for (const [index, value] of [[3, 5], [4, 255], [5, 1], [6, 128], [7, 128], [8, 128], [9, 128]]) {
    const bad = valid.slice(); bad[index] = value;
    assert.equal(sniffProviderOutputType(bad), null);
  }
  const falseMagic = taggedAudio(new Uint8Array(50)); falseMagic.set(flacHeader(), 20);
  assert.equal(sniffProviderOutputType(falseMagic), null, 'FLAC-looking tag artwork is not audio');
  assert.equal(PROVIDER_SNIFF_BYTES, 128 * 1024);
  assert.equal(sniffProviderOutputType(taggedAudio(flacHeader(), { size: PROVIDER_SNIFF_BYTES })), null);
  const footer = taggedAudio(flacHeader(), { footer: true }); footer[13075] = 0;
  assert.equal(sniffProviderOutputType(footer), null);
});

test('FLAC requires valid bounded STREAMINFO, metadata and a frame header, not magic alone', () => {
  for (const [index, value] of [[4, 0x81], [7, 33], [8, 0], [9, 1], [21, 0], [42, 0], [44, 0xf]]) {
    const bad = flacHeader(); bad[index] = value;
    assert.equal(sniffProviderOutputType(bad), null, `invalid FLAC byte ${index}`);
  }
  const zeroRate = flacHeader(); zeroRate[18] = 0; zeroRate[19] = 0; zeroRate[20] &= 15;
  assert.equal(sniffProviderOutputType(zeroRate), null);
  for (let length = 4; length < 46; length++) assert.equal(sniffProviderOutputType(flacHeader().subarray(0, length)), null);
  assert.equal(sniffProviderOutputType(new TextEncoder().encode('<html>fLaC</html>')), null);
});

test('other existing media signatures remain unchanged and unknown bytes stay inert', () => {
  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  assert.equal(sniffProviderOutputType(png), 'image/png');
  assert.equal(sniffProviderOutputType(new Uint8Array()), null);
});
