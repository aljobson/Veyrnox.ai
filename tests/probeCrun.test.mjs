import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseProbe, summariseStreams, isMp4, imageKind } from '../scripts/probe-crun.mjs';
import { parseEndpoint } from '../packages/adapters/crun.js';

test('every probe maps to an endpoint the adapter parses', () => {
  for (const name of ['veo-lite', 'veo-fast', 'seedance-fast', 'nano-banana', 'seedream']) {
    const r = chooseProbe([name]);
    assert.equal(r.ok, true);
    assert.ok(parseEndpoint(r.probe.endpoint), name);
  }
});
test('the dear probe needs --yes and an unknown name is refused', () => {
  assert.equal(chooseProbe(['veo']).ok, false);
  assert.equal(chooseProbe(['veo', '--yes']).ok, true);
  assert.equal(chooseProbe(['nope']).ok, false);
  assert.equal(chooseProbe([]).ok, false);
});

test('--keep and its folder are not read as the probe name', () => {
  assert.equal(chooseProbe(['--keep', '/tmp/x', 'veo-lite']).name, 'veo-lite');
  assert.equal(chooseProbe(['veo-lite', '--keep', '/tmp/x']).name, 'veo-lite');
  assert.equal(chooseProbe(['--keep', '/tmp/x']).ok, false);
});

test('the clip summary reports duration, size, codec and audio from ffprobe JSON', () => {
  const info = summariseStreams({ format: { duration: '8.041' }, streams: [{ codec_type: 'video', width: 1280, height: 720, codec_name: 'h264' }, { codec_type: 'audio' }] });
  assert.deepEqual(info, { durationSeconds: 8.041, width: 1280, height: 720, videoCodec: 'h264', hasAudio: true });
  assert.deepEqual(summariseStreams(null), { durationSeconds: 0, width: null, height: null, videoCodec: null, hasAudio: false });
});

test('only bytes that start like an MP4 are ever written', () => {
  assert.equal(isMp4(Buffer.from('00000020667479706d703432000000006d70343269736f6d', 'hex')), true);
  assert.equal(isMp4(Buffer.from('<html>not a video</html>')), false);
  assert.equal(isMp4(Buffer.alloc(4)), false);
});

test('image probes are kept only when the bytes are a PNG, JPEG or WebP', () => {
  assert.equal(chooseProbe(['nano-banana']).probe.image, true);
  assert.equal(imageKind(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)])), 'png');
  assert.equal(imageKind(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(12)])), 'jpg');
  assert.equal(imageKind(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(4)])), 'webp');
  assert.equal(imageKind(Buffer.from('<html>not an image at all</html>')), null);
  assert.equal(imageKind(Buffer.alloc(4)), null);
});
