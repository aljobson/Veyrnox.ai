// Download on a Library card (audit Q-03). The card said "Save a copy before then" and offered no way to do it.
// The asset route can now sign a link that tells the browser to save the file: same ownership check, same quota,
// same 15-minute life, with a file name made on the server. The signature is recomputed here from the SigV4 rules,
// independently of the adapter, because a wrongly encoded or wrongly ordered query is refused by R2, not by a unit test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { flacHeader, mp3Frame, taggedAudio } from './fixtures/providerAudio.mjs';
register('data:text/javascript,' + encodeURIComponent(
  `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
Object.assign(process.env, {
  SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service',
  R2_ACCOUNT_ID: 'test-account', R2_ACCESS_KEY_ID: 'test-access',
  R2_SECRET_ACCESS_KEY: 'test-secret', R2_BUCKET: 'test-bucket',
  ASSET_LINK_RATE_LIMIT_ENABLED: 'true',
});
const { presignGetUrl } = await import('../packages/adapters/r2.js');
const { assetDownloadName } = await import('../lib/assetDownloadName.js');
const { assetErrorMessage } = await import('../app/veyrnox/_lib/assetRefresh.js');
const { GET } = await import('../app/api/v1/jobs/[id]/asset/route.js');

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const CFG = { accountId: 'acc123', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret/with+chars', bucket: 'veyrnox-media' };
const KEY = 'fal/r1/a file.png';
const DISPOSITION = 'response-content-disposition';

// RFC 3986 unreserved characters only, written out here so the check does not share the adapter's encoder.
const enc = (s) => [...Buffer.from(String(s), 'utf8')].map((b) => {
  const c = String.fromCharCode(b);
  return /[A-Za-z0-9\-._~]/.test(c) ? c : `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
}).join('');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

/** The signature SigV4 expects for a presigned GET, computed from the URL's own parts. */
function expectedSignature(url, secret) {
  const u = new URL(url);
  const pairs = [...u.searchParams.entries()].filter(([k]) => k !== 'X-Amz-Signature');
  const canonicalQuery = pairs.map(([k, v]) => [enc(k), enc(v)])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('&');
  const amzDate = u.searchParams.get('X-Amz-Date');
  const scope = `${amzDate.slice(0, 8)}/auto/s3/aws4_request`;
  const canonicalRequest = `GET\n${u.pathname}\n${canonicalQuery}\nhost:${u.host}\n\nhost\nUNSIGNED-PAYLOAD`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${createHash('sha256').update(canonicalRequest).digest('hex')}`;
  const signing = ['auto', 's3', 'aws4_request'].reduce((k, part) => hmac(k, part), hmac(`AWS4${secret}`, amzDate.slice(0, 8)));
  return hmac(signing, stringToSign).toString('hex');
}

test('a download link carries a signed attachment header with the given file name', async () => {
  const { url, expires } = await presignGetUrl(KEY, 900, CFG, { downloadFilename: 'veyrnox-11111111.png' });
  const u = new URL(url);
  assert.equal(u.searchParams.get(DISPOSITION), 'attachment; filename="veyrnox-11111111.png"');
  assert.equal(expires, 900, 'the 15-minute ceiling is unchanged');
  assert.equal(u.searchParams.get('X-Amz-Signature'), expectedSignature(url, CFG.secretAccessKey));
  // A space must travel as %20: "+" is a literal plus to SigV4, and R2 would refuse the signature.
  assert.match(url, /response-content-disposition=attachment%3B%20filename%3D%22veyrnox-11111111\.png%22/);
  assert.doesNotMatch(url.split('?')[1], /\+/);
});

test('a link asked for without a file name is signed exactly as before', async () => {
  const { url } = await presignGetUrl(KEY, 300, CFG);
  const u = new URL(url);
  assert.equal(u.searchParams.has(DISPOSITION), false);
  assert.deepEqual([...u.searchParams.keys()],
    ['X-Amz-Algorithm', 'X-Amz-Credential', 'X-Amz-Date', 'X-Amz-Expires', 'X-Amz-SignedHeaders', 'X-Amz-Signature']);
  assert.equal(u.searchParams.get('X-Amz-Signature'), expectedSignature(url, CFG.secretAccessKey));
  // The query the adapter wrote before this change, rebuilt the old way from the same values.
  const old = new URLSearchParams([...u.searchParams.entries()].filter(([k]) => k !== 'X-Amz-Signature'));
  assert.equal(url.split('?')[1], `${old.toString()}&X-Amz-Signature=${u.searchParams.get('X-Amz-Signature')}`);
});

test('a file name that could break out of the header is refused before anything is signed', async () => {
  for (const bad of ['a"b.png', 'a\r\nx: y', 'a b.png', '../a.png', 'a/b.png', 'a;b', '', 'é.png', 'x'.repeat(81)]) {
    await assert.rejects(presignGetUrl(KEY, 900, CFG, { downloadFilename: bad }), /invalid download file name/, JSON.stringify(bad));
  }
});

test('the sole FLAC response override is signed and cannot be replaced or injected', async () => {
  const { url } = await presignGetUrl(KEY, 900, CFG, { downloadFilename: 'veyrnox-11111111.flac', responseContentType: 'audio/flac' });
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('response-content-type'), 'audio/flac');
  assert.equal(parsed.searchParams.get('X-Amz-Signature'), expectedSignature(url, CFG.secretAccessKey));
  parsed.searchParams.set('response-content-type', 'text/html');
  assert.notEqual(parsed.searchParams.get('X-Amz-Signature'), expectedSignature(parsed.href, CFG.secretAccessKey));
  for (const bad of ['text/html', 'audio/mpeg', 'audio/flac\r\nx-evil: true', 'AUDIO/FLAC', '', null]) {
    await assert.rejects(presignGetUrl(KEY, 900, CFG, { responseContentType: bad }), /invalid response content type/);
  }
});

test('the file name is made from the job id and a fixed list of extensions', () => {
  const id = 'ABCDEF12-1111-4111-8111-111111111111';
  assert.equal(assetDownloadName(id, 'image/png'), 'veyrnox-abcdef12.png');
  assert.equal(assetDownloadName(id, 'image/jpeg'), 'veyrnox-abcdef12.jpg');
  assert.equal(assetDownloadName(id, 'image/webp'), 'veyrnox-abcdef12.webp');
  assert.equal(assetDownloadName(id, 'video/mp4'), 'veyrnox-abcdef12.mp4');
  assert.equal(assetDownloadName(id, 'audio/mpeg'), 'veyrnox-abcdef12.mp3');
  assert.equal(assetDownloadName(id, 'audio/wav'), 'veyrnox-abcdef12.wav');
  assert.equal(assetDownloadName(id, 'audio/flac'), 'veyrnox-abcdef12.flac');
  assert.equal(assetDownloadName(id, 'VIDEO/MP4'), 'veyrnox-abcdef12.mp4');
  // A type that is not on the list gets no extension, never text taken from the type.
  for (const odd of ['application/x-evil"; x=', 'text/html', '', null, undefined]) {
    assert.equal(assetDownloadName(id, odd), 'veyrnox-abcdef12');
  }
});

const id = '11111111-1111-4111-8111-111111111111';
const get = (query = '') => GET(new Request(`https://veyrnox.test/api/v1/jobs/${id}/asset${query}`, {
  headers: { 'x-veyrnox-auth-id': 'verified-user' },
}), { params: Promise.resolve({ id }) });
let calls;
function stub(mime = 'image/png') {
  calls = [];
  globalThis.fetch = async (url, init) => {
    if (new URL(url).hostname.endsWith('.r2.cloudflarestorage.com')) {
      calls.push('range');
      assert.equal(init.headers.Range, 'bytes=0-416');
      assert.equal(init.redirect, 'manual');
      return new Response(mp3Frame(), { status: 206, headers: { 'content-range': 'bytes 0-416/417' } });
    }
    const name = String(url).split('/').pop(); calls.push(name);
    if (name === 'consume_asset_link_request') return Response.json({ ok: true });
    return Response.json({ ok: true, r2_key: 'private/file.png', mime_type: mime, size_bytes: mime === 'audio/mpeg' ? 417 : 1 });
  };
}

test('?download=1 returns a link that saves the file, after the same quota and ownership checks', async () => {
  stub('video/mp4');
  const response = await get('?download=1');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(new URL(body.url).searchParams.get(DISPOSITION), 'attachment; filename="veyrnox-11111111.mp4"');
  assert.equal(body.expires_in, 900);
  assert.deepEqual(calls, ['consume_asset_link_request', 'get_user_asset']);
});

test('without the parameter the link is the one the page already used', async () => {
  stub();
  const body = await (await get()).json();
  assert.equal(new URL(body.url).searchParams.has(DISPOSITION), false);
});

test('any other value of download is refused before quota is used', async () => {
  for (const query of ['?download=true', '?download=0', '?download=', '?download=1&download=1', '?download=veyrnox.png']) {
    stub();
    const response = await get(query);
    assert.equal(response.status, 400, query);
    assert.deepEqual(await response.json(), { error: 'invalid_download' });
    assert.deepEqual(calls, [], query);
  }
});

test('a download of a job that is not the caller\'s is a 404 like any other read', async () => {
  const seen = [];
  globalThis.fetch = async (url) => {
    const name = String(url).split('/').pop(); seen.push(name);
    return Response.json(name === 'consume_asset_link_request' ? { ok: true } : { ok: false, code: 'NOT_FOUND' });
  };
  const response = await get('?download=1');
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'not_found' });
});

test('the card and the preview share one set of messages for a link that cannot be had', () => {
  assert.equal(assetErrorMessage({ status: 404 }), 'This file is no longer available.');
  assert.equal(assetErrorMessage({ status: 401 }), 'Sign in again to load this file.');
  assert.equal(assetErrorMessage({ status: 429 }), 'Too many file requests. Wait a minute, then retry.');
  assert.equal(assetErrorMessage(new Error('offline')), 'Could not load this file. Try again.');
  assert.equal(assetErrorMessage(undefined), 'Could not load this file. Try again.');
});

test('the Library card offers Download between the chat shortcut and the retention line', () => {
  const footer = read('../app/veyrnox/_components/AssetFooter.js');
  assert.match(footer, /<AskAboutThis row=\{row\} \/>\s*<DownloadAsset row=\{row\} \/>\s*<AssetRetention row=\{row\} \/>/);
});

test('the Download button asks for a save link once per click and only follows an https link', () => {
  const button = read('../app/veyrnox/_components/DownloadAsset.js');
  assert.match(button, /gatewayFetch\(`\/jobs\/\$\{encodeURIComponent\(row\.job_id\)\}\/asset\?download=1`\)/);
  assert.match(button, /if \(busyRef\.current\) return;/, 'a second click does not ask for a second link');
  assert.match(button, /asset\.url\.startsWith\('https:\/\/'\)/);
  // Same tab: a click that waited for the link is not a user gesture any more, and Safari would block a new tab.
  assert.match(button, /window\.location\.assign\(asset\.url\)/);
  assert.doesNotMatch(button, /window\.open/);
  assert.match(button, /setError\(assetErrorMessage\(e\)\)/);
  assert.match(button, /row\?\.state !== 'succeeded' \|\| row\.has_asset === false \|\| !row\.asset_url/, 'only a finished job with a file');
});

 test('stem download validates labels before quota and signs the exact owned stem with unchanged TTL',async()=>{
 for(const query of ['?stem=unknown','?stem=','?stem=vocals&stem=bass']){stub();assert.equal((await get(query)).status,400);assert.deepEqual(calls,[]);}
 stub('audio/mpeg');const r=await get('?stem=bass&download=1'),body=await r.json();assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(body.expires_in,900);
 assert.deepEqual(calls,['consume_asset_link_request','get_user_audio_stem','range']);assert.match(new URL(body.url).searchParams.get(DISPOSITION),/-bass.mp3/);
 });

function legacy(body, { code, rate, total = body.length, status = 206, contentRange, responseBody = body } = {}) {
  calls = [];
  globalThis.fetch = async (url, init) => {
    const target = new URL(url);
    if (target.hostname.endsWith('.r2.cloudflarestorage.com')) {
      calls.push('range');
      assert.equal(target.pathname, '/test-bucket/private/owned.mp3');
      assert.equal(init.redirect, 'manual');
      const end = Math.min(total, 128 * 1024) - 1;
      assert.equal(init.headers.Range, `bytes=0-${end}`);
      return new Response(responseBody, { status, headers: { 'content-range': contentRange ?? `bytes 0-${end}/${total}` } });
    }
    const name = target.pathname.split('/').pop(); calls.push(name);
    if (name === 'consume_asset_link_request') return Response.json(rate ?? { ok: true });
    return Response.json(code ? { ok: false, code } : { ok: true, r2_key: 'private/owned.mp3', mime_type: 'audio/mpeg', size_bytes: total });
  };
}

test('owned legacy FLAC download corrects only the signed response, not stored bytes or metadata', async () => {
  legacy(taggedAudio(flacHeader()));
  const response = await get('?download=1');
  assert.equal(response.status, 200);
  const body = await response.json(), url = new URL(body.url);
  assert.equal(body.mime_type, 'audio/flac');
  assert.equal(body.size_bytes, 13121);
  assert.equal(url.searchParams.get('response-content-type'), 'audio/flac');
  assert.equal(url.searchParams.get(DISPOSITION), 'attachment; filename="veyrnox-11111111.flac"');
  assert.equal(body.expires_in, 900);
  assert.deepEqual(calls, ['consume_asset_link_request', 'get_user_asset', 'range']);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('legacy audio previews and already-correct FLAC downloads do not read object bytes', async () => {
  legacy(taggedAudio(flacHeader()));
  const body = await (await get()).json();
  assert.equal(body.mime_type, 'audio/mpeg');
  assert.equal(new URL(body.url).searchParams.has('response-content-type'), false);
  assert.deepEqual(calls, ['consume_asset_link_request', 'get_user_asset']);
  stub('audio/flac');
  const correct = await (await get('?download=1')).json();
  assert.equal(correct.mime_type, 'audio/flac');
  assert.match(new URL(correct.url).searchParams.get(DISPOSITION), /\.flac"$/);
  assert.deepEqual(calls, ['consume_asset_link_request', 'get_user_asset']);
});

test('legacy detection remains after rate, ownership, hold and expiry gates', async () => {
  for (const code of ['NOT_FOUND', 'HELD', 'EXPIRED']) {
    legacy(flacHeader(), { code });
    assert.equal((await get('?download=1')).status, 404);
    assert.deepEqual(calls, ['consume_asset_link_request', 'get_user_asset']);
  }
  legacy(flacHeader(), { rate: { ok: false, code: 'RATE_LIMITED' } });
  assert.equal((await get('?download=1')).status, 429);
  assert.deepEqual(calls, ['consume_asset_link_request']);
});

test('legacy invalid audio and untrusted range responses fail closed without returning a URL', async () => {
  for (const options of [{ status: 200 }, { status: 302 }, { contentRange: 'bytes 0-45/999' },
    { responseBody: new Uint8Array(1) }, { total: 0 }, { total: -1 }, { total: 1.5 }, { total: '13121' }]) {
    legacy(taggedAudio(flacHeader()), options);
    const response = await get('?download=1');
    assert.equal(response.status, 502, JSON.stringify(options));
    assert.deepEqual(await response.json(), { error: 'internal' });
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  for (const bytes of [taggedAudio(new Uint8Array(50)), new TextEncoder().encode('<html>invalid audio</html>'), taggedAudio(flacHeader(), { size: 128 * 1024 })]) {
    legacy(bytes, { responseBody: bytes.subarray(0, 128 * 1024) });
    assert.equal((await get('?download=1')).status, 502);
  }
});
