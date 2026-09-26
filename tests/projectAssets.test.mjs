import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inspectProjectAsset, inspectionRpcArgs, REJECT_REASONS,
  ASSET_URL_TTL_SECONDS, MAX_VIDEO_SECONDS, MAX_FRAME_SIDE,
} from '../lib/projectAssets.js';

// ── fixtures ──────────────────────────────────────────────────────────────

function png(width = 1920, height = 1080, length = 64) {
  const b = new Uint8Array(length);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.set([0, 0, 0, 13], 8);
  b.set([0x49, 0x48, 0x44, 0x52], 12);
  const v = new DataView(b.buffer);
  v.setUint32(16, width);
  v.setUint32(20, height);
  return b;
}

const box = (type, payload) => {
  const b = new Uint8Array(8 + payload.length);
  new DataView(b.buffer).setUint32(0, b.length);
  b.set([...type].map(c => c.charCodeAt(0)), 4);
  b.set(payload, 8);
  return b;
};
const join = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

/** A minimal but structurally real MP4: ftyp, then moov with mvhd and trak/tkhd. */
function mp4({ seconds = 5, width = 1280, height = 720, trailingMoov = false, timescale = 1000 } = {}) {
  const mvhd = new Uint8Array(100);
  new DataView(mvhd.buffer).setUint32(12, timescale);
  new DataView(mvhd.buffer).setUint32(16, Math.round(seconds * timescale));
  const tkhd = new Uint8Array(84);
  const tv = new DataView(tkhd.buffer);
  tv.setUint32(76, width * 65536);
  tv.setUint32(80, height * 65536);
  const moov = box('moov', join(box('mvhd', mvhd), box('trak', box('tkhd', tkhd))));
  const ftyp = box('ftyp', new Uint8Array([0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0]));
  const mdat = box('mdat', new Uint8Array(512));
  return trailingMoov ? join(ftyp, mdat, moov) : join(ftyp, moov, mdat);
}

const rangeOver = (bytes) => async (start, end) => bytes.slice(start, Math.min(end + 1, bytes.length));

const inspect = (declaredType, bytes, byteSize = bytes.length) =>
  inspectProjectAsset({ declaredType, byteSize, head: bytes, readRange: rangeOver(bytes) });

// ── the happy paths ───────────────────────────────────────────────────────

test('a real PNG passes and records its frame', async () => {
  const v = await inspect('image/png', png(1920, 1080));
  assert.equal(v.ok, true);
  assert.equal(v.sniffedType, 'image/png');
  assert.equal(v.width, 1920);
  assert.equal(v.height, 1080);
  assert.equal(v.durationMs, null, 'a still has no duration');
});

test('an MP4 passes and records duration and frame', async () => {
  const bytes = mp4({ seconds: 12, width: 1280, height: 720 });
  const v = await inspect('video/mp4', bytes);
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.equal(v.durationMs, 12000);
  assert.equal(v.width, 1280);
  assert.equal(v.height, 720);
});

test('an MP4 whose moov sits after the media data still passes', async () => {
  // The subtlety worth pinning: a file that is not fast-start must not be
  // refused for having its duration at the end.
  const bytes = mp4({ seconds: 7, trailingMoov: true });
  const v = await inspect('video/mp4', bytes);
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.equal(v.durationMs, 7000);
});

// ── the refusals ──────────────────────────────────────────────────────────

test('HTML dressed as a PNG is refused on the bytes, not the claim', async () => {
  const html = new Uint8Array([...'<!doctype html><html><body>hi</body></html>'].map(c => c.charCodeAt(0)));
  const v = await inspect('image/png', html);
  assert.equal(v.ok, false);
  assert.equal(v.reason, REJECT_REASONS.unreadable);
});

test('a real PNG reserved as a video is a type mismatch', async () => {
  const v = await inspect('video/mp4', png());
  assert.equal(v.ok, false);
  assert.equal(v.reason, REJECT_REASONS.mismatch);
});

test('a head too short to sniff is unreadable, not a pass', async () => {
  const v = await inspect('image/png', new Uint8Array([0x89, 0x50]));
  assert.equal(v.ok, false);
  assert.equal(v.reason, REJECT_REASONS.unreadable);
});

test('an object larger than its type ceiling is refused', async () => {
  // 20 MiB is the image cap; the stored size is what counts, not the claim.
  const v = await inspect('image/png', png(), 20 * 1024 * 1024 + 1);
  assert.equal(v.ok, false);
  assert.equal(v.reason, REJECT_REASONS.tooLarge);
});

test('a media type off the allowlist cannot be inspected into acceptance', async () => {
  for (const type of ['application/zip', 'text/html', '', null]) {
    const v = await inspect(type, png());
    assert.equal(v.ok, false, `accepted ${JSON.stringify(type)}`);
  }
});

test('a video with no readable duration is refused', async () => {
  const ftypOnly = join(box('ftyp', new Uint8Array([0x69, 0x73, 0x6f, 0x6d])), box('mdat', new Uint8Array(64)));
  const v = await inspect('video/mp4', ftypOnly);
  assert.equal(v.ok, false);
  assert.equal(v.reason, REJECT_REASONS.noDuration);
});

test('a video longer than the limit is refused', async () => {
  const v = await inspect('video/mp4', mp4({ seconds: MAX_VIDEO_SECONDS + 1 }));
  assert.equal(v.ok, false);
  assert.equal(v.reason, REJECT_REASONS.tooLong);
});

test('a frame larger than the limit is refused, for video and for stills', async () => {
  const big = MAX_FRAME_SIDE + 1;
  assert.equal((await inspect('video/mp4', mp4({ width: big }))).reason, REJECT_REASONS.tooBigFrame);
  assert.equal((await inspect('image/png', png(big, 10))).reason, REJECT_REASONS.tooBigFrame);
});

// ── the shape handed to the RPC ───────────────────────────────────────────

test('the RPC arguments carry a type or a reason, never both and never neither', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const pass = inspectionRpcArgs(id, { ok: true, sniffedType: 'video/mp4', byteSize: 10, durationMs: 1000, width: 2, height: 3 });
  assert.equal(pass.p_sniffed_type, 'video/mp4');
  assert.equal(pass.p_reject_reason, null);
  const fail = inspectionRpcArgs(id, { ok: false, reason: REJECT_REASONS.mismatch });
  assert.equal(fail.p_sniffed_type, null);
  assert.equal(fail.p_reject_reason, 'type_mismatch');
  // The database refuses anything else, so neither shape may drift.
  for (const args of [pass, fail]) {
    assert.equal(args.p_asset_id, id);
    assert.notEqual(args.p_sniffed_type === null, args.p_reject_reason === null);
  }
});

test('every reject reason fits the column the database accepts', () => {
  for (const reason of Object.values(REJECT_REASONS)) assert.match(reason, /^[a-z_]{3,40}$/);
});

test('presigned project-asset URLs stay inside the 15-minute rule', () => {
  assert.ok(ASSET_URL_TTL_SECONDS <= 900, 'CLAUDE.md: presigned URL TTL <= 15 min');
});
