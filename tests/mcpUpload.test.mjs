import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { reserveMcpUpload, checkSourceUploads, acceptedUploadTypes, MCP_UPLOAD_TYPES, MCP_UPLOAD_MAX_BYTES, MCP_UPLOAD_KEY_RE } from '../lib/mcpUpload.js';
import { ALLOWED_UPLOAD_TYPES } from '../lib/uploadSource.js';

register('data:text/javascript,' + encodeURIComponent(
  `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));

const AUTH = '33333333-3333-4333-8333-333333333333';
const KEY = `uploads/${AUTH}/44444444-4444-4444-8444-444444444444.png`;
const GRANT = { key: KEY, upload_url: 'https://r2.test/x?X-Amz-Signature=s', content_type: 'image/png', headers: { 'Content-Type': 'image/png', 'If-None-Match': '*' }, max_bytes: 20971520, expires_in: 900, reserved: true, reserved_until: '2026-11-01T10:00:00.000Z' };

function harness(reply = { status: 200, body: GRANT }) {
  const calls = [];
  return { calls, deps: { async reserveUpload(body) { calls.push(body); return { response: { ok: reply.status < 400, status: reply.status }, data: reply.body }; } } };
}

test('the accepted types and ceilings are the upload allowlist itself, so the connector can never widen what the web app accepts', () => {
  assert.deepEqual(MCP_UPLOAD_TYPES, Object.keys(ALLOWED_UPLOAD_TYPES));
  assert.deepEqual(acceptedUploadTypes(), Object.entries(ALLOWED_UPLOAD_TYPES).map(([content_type, rule]) => ({ content_type, max_bytes: rule.maxBytes })));
  assert.equal(MCP_UPLOAD_MAX_BYTES, 100 * 1024 * 1024);
  assert.ok(MCP_UPLOAD_KEY_RE.test(KEY));
  assert.ok(!MCP_UPLOAD_KEY_RE.test('uploads/../x.png') && !MCP_UPLOAD_KEY_RE.test(`${KEY}/..`) && !MCP_UPLOAD_KEY_RE.test('assets/x.png'));
});

test('a reservation sends only the declared type and size to the uploads route and returns its grant with PUT instructions', async () => {
  const { deps, calls } = harness();
  const result = await reserveMcpUpload({ content_type: 'image/png', size_bytes: 1024, key: 'uploads/x', upload_url: 'https://evil.example' }, deps);
  assert.deepEqual(calls, [{ content_type: 'image/png', size_bytes: 1024 }]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, {
    key: KEY, upload_url: GRANT.upload_url, method: 'PUT', content_type: 'image/png', headers: GRANT.headers,
    max_bytes: 20971520, expires_in: 900, reserved_until: GRANT.reserved_until, accepted_content_types: acceptedUploadTypes(), instruction: result.data.instruction,
  });
  assert.match(result.data.instruction, /PUT .*within 900 seconds/);
  assert.match(result.data.instruction, /source_uploads/);
  assert.match(result.data.instruction, /consent: true/);
});

test('every refusal of the uploads route passes through untouched: type, size, balance, rate limit, pending cap, budget, admission', async () => {
  for (const [status, error] of [[400, 'upload_type_not_allowed'], [400, 'upload_too_large'], [402, 'insufficient_credits'], [429, 'rate_limited'], [429, 'too_many_pending_uploads'], [429, 'upload_budget_exceeded'], [503, 'upload_admission_unavailable'], [409, 'user_not_provisioned']]) {
    const { deps } = harness({ status, body: { error } });
    const result = await reserveMcpUpload({ content_type: 'image/png', size_bytes: 1 }, deps);
    assert.deepEqual([result.ok, result.status, result.body], [false, status, { error }]);
  }
});

test('a source upload must be a key the uploads route mints, in a slot of its own media kind', () => {
  const video = KEY.replace(/png$/, 'mp4'), audio = KEY.replace(/png$/, 'mp3');
  assert.deepEqual(checkSourceUploads([{ key: KEY, slot: 'image' }, { key: KEY, slot: 'endImage' }, { key: video, slot: 'video' }, { key: audio, slot: 'audio' }]), { ok: true });
  assert.deepEqual(checkSourceUploads(undefined), { ok: true });
  for (const [refs, error] of [
    [[{ key: KEY.replace(/png$/, 'exe'), slot: 'image' }], 'source_upload_invalid'],
    [[{ key: `generated/${AUTH}/44444444-4444-4444-8444-444444444444.png`, slot: 'image' }], 'source_upload_invalid'],
    [[{ key: `${KEY}?x=1`, slot: 'image' }], 'source_upload_invalid'],
    [[{ slot: 'image' }], 'source_upload_invalid'],
    [[{ key: video, slot: 'image' }], 'source_upload_kind_mismatch'],
    [[{ key: KEY, slot: 'audio' }], 'source_upload_kind_mismatch'],
    [[{ key: audio, slot: 'endImage' }], 'source_upload_kind_mismatch'],
  ]) {
    const result = checkSourceUploads(refs);
    assert.deepEqual([result.ok, result.body.error], [false, error], error);
    assert.match(result.body.instruction, /reserve_source_upload/);
  }
});

// Through the real MCP handler and the real uploads route: the grant comes back keyed to the signed-in account, from the route's own
// identity header, with nothing read from the tool arguments but the declared type and size.
async function callTool(name, args, fetchImpl, t) {
  Object.assign(process.env, {
    SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service', PUBLIC_HOST: 'https://veyrnox.test',
    R2_ACCOUNT_ID: 'test', R2_ACCESS_KEY_ID: 'test', R2_SECRET_ACCESS_KEY: 'test', R2_BUCKET: 'test',
  });
  t.mock.method(globalThis, 'fetch', fetchImpl);
  const { POST } = await import('../app/api/v1/mcp/route.js');
  const response = await POST(new Request('https://veyrnox.test/api/v1/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json', accept: 'application/json, text/event-stream',
      'x-veyrnox-auth-id': AUTH, 'x-veyrnox-auth-client-id': '9a8b7c6d-5e4f-3a2b-1c0d-9e8f7a6b5c4d',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } }),
  }));
  const text = await response.text();
  return JSON.parse(text.includes('data:') ? text.split('data:').pop().trim() : text).result;
}

test('a signed-in MCP client gets a 15-minute presigned PUT for a PNG, keyed to its own account', async (t) => {
  const paths = [];
  const result = await callTool('reserve_source_upload', { content_type: 'image/png', size_bytes: 4096 }, async (url) => {
    const path = new URL(String(url)).pathname; paths.push(path);
    if (path.endsWith('/read_user_balance')) return Response.json(10);
    if (path.endsWith('/rpc/reserve_upload')) return Response.json({ ok: true });
    if (path.endsWith('/upload_reservations')) return Response.json([]);
    return new Response('<ListBucketResult></ListBucketResult>');
  }, t);
  assert.equal(result.isError, undefined, JSON.stringify(result.structuredContent));
  const grant = result.structuredContent;
  assert.match(grant.key, new RegExp(`^uploads/${AUTH}/[0-9a-f-]{36}\\.png$`));
  assert.equal(grant.content_type, 'image/png');
  assert.equal(grant.method, 'PUT');
  assert.equal(grant.expires_in, 900);
  assert.equal(grant.max_bytes, 20 * 1024 * 1024);
  const signed = new URL(grant.upload_url);
  assert.equal(signed.searchParams.get('X-Amz-Expires'), '900');
  assert.ok(signed.pathname.endsWith(grant.key));
  assert.equal(grant.headers['Content-Type'], 'image/png');
  assert.deepEqual(grant.accepted_content_types.map((entry) => entry.content_type), MCP_UPLOAD_TYPES);
  assert.ok(paths.some((p) => p.endsWith('/read_user_balance')), 'the uploads route still checks the balance');
  assert.match(result.content[0].text, /reserved upload uploads\//);
});

test('through the real handler, a type outside the allowlist and an oversize file are refused by the schema before the uploads route is reached', async (t) => {
  for (const args of [{ content_type: 'image/gif', size_bytes: 10 }, { content_type: 'image/png', size_bytes: 101 * 1024 * 1024 }, { content_type: 'image/png', size_bytes: 0 }]) {
    const result = await callTool('reserve_source_upload', args, async (url) => assert.fail(`reached ${new URL(String(url)).pathname}`), t);
    assert.equal(result.isError, true, JSON.stringify(args));
  }
});

test('through the real handler, an account with no credits gets the route\'s refusal and no URL', async (t) => {
  const result = await callTool('reserve_source_upload', { content_type: 'image/jpeg', size_bytes: 10 }, async (url) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith('/read_user_balance')) return Response.json(0);
    return new Response('<ListBucketResult></ListBucketResult>');
  }, t);
  assert.deepEqual([result.isError, result.structuredContent.error, result.structuredContent.upload_url], [true, 'insufficient_credits', undefined]);
});
