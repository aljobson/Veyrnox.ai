import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectCloudSelection, cloudSelectionFingerprint } from '../lib/cinema/cloud/selection.js';
const choices = [
  [{ provider: 'google_drive', file_id: 'file1' }, { id: 'file1', name: 'clip.mp4', size: '123', mimeType: 'video/mp4', version: '2', trashed: false, capabilities: { canDownload: true } }, 'www.googleapis.com'],
  [{ provider: 'dropbox', file_id: 'id:file1' }, { '.tag': 'file', id: 'id:file1', name: 'clip.mp4', size: 123, rev: 'r2' }, 'api.dropboxapi.com'],
  [{ provider: 'onedrive', file_id: 'file1', drive_id: 'drive1' }, { id: 'file1', name: 'clip.mp4', size: 123, eTag: 'v2', file: { mimeType: 'video/mp4' }, parentReference: { driveId: 'drive1' } }, 'graph.microsoft.com'],
];
for (const [input, row, host] of choices) {
  test(`${input.provider} verifies metadata at a fixed provider endpoint`, async () => {
    const file = await inspectCloudSelection(input, 'test-token', async (url, init) => {
      assert.equal(new URL(url).hostname, host);
      assert.equal(init.redirect, 'manual');
      assert.equal(init.headers.Authorization, 'Bearer test-token');
      assert.ok(init.signal);
      return Response.json({ ...row, downloadUrl: 'https://evil.invalid/token' });
    });
    assert.equal(file.size, 123);
    assert.equal(file.mime_type, 'video/mp4');
    assert.equal(JSON.stringify(file).includes('evil'), false);
    assert.equal(JSON.stringify(file).includes('test-token'), false);
  });
  test(`${input.provider} rejects changed identity and oversized content`, async () => {
    await assert.rejects(inspectCloudSelection(input, 'token', async () => Response.json({ ...row, id: 'different' })), /cloud_file_unavailable/);
    await assert.rejects(inspectCloudSelection(input, 'token', async () => Response.json({ ...row, size: input.provider === 'google_drive' ? '2147483649' : 2147483649 })), /cloud_video_not_supported/);
  });
  test(`${input.provider} rejects non-object metadata with a safe error`, async () => {
    for (const row of [null, [], 'provider secret', 42, true]) {
      await assert.rejects(inspectCloudSelection(input, 'token', async () => Response.json(row)), /^Error: cloud_metadata_invalid$/);
    }
  });
}
test('rejects URLs, unsupported providers and unrecognized input fields before network I/O', async () => {
  for (const input of [{provider:'gdrive',file_id:'x'}, {provider:'google_drive',file_id:'https://localhost'}, {provider:'google_drive',file_id:'..'}, {...choices[0][0],url:'https://localhost'}, {...choices[2][0],drive_id:'../me'}]) {
    await assert.rejects(inspectCloudSelection(input, 'token', () => assert.fail('network must not run')), /invalid_cloud_selection/);
  }
});
test('rejects missing and header-injected credentials before network I/O', async () => {
  for (const token of ['', 'x\r\nInjected: y']) await assert.rejects(inspectCloudSelection(choices[0][0], token, () => assert.fail('network must not run')), /invalid_cloud_credential/);
});
test('refuses redirects without leaking credentials to a second host', async () => {
  let calls = 0;
  await assert.rejects(inspectCloudSelection(choices[0][0], 'token', async () => { calls++; return new Response(null, {status:302,headers:{Location:'http://127.0.0.1'}}); }), /cloud_metadata_unavailable/);
  assert.equal(calls, 1);
});
test('redacts provider error bodies and bounds metadata', async () => {
  await assert.rejects(inspectCloudSelection(choices[0][0], 'token', async () => new Response('secret provider detail', {status:403})), /^Error: cloud_access_denied$/);
  await assert.rejects(inspectCloudSelection(choices[0][0], 'token', async () => new Response('x'.repeat(65537))), /cloud_metadata_invalid/);
});
test('rejects OneDrive shortcuts and deleted items', async () => {
  for (const field of ['remoteItem','deleted','folder']) await assert.rejects(inspectCloudSelection(choices[2][0], 'token', async () => Response.json({...choices[2][1],[field]:{}})), /cloud_file_unavailable/);
});
test('fingerprint changes with connection, source version or size', async () => {
  const file = await inspectCloudSelection(choices[0][0], 'token', async () => Response.json(choices[0][1]));
  const connection = '11111111-1111-4111-8111-111111111111';
  const first = await cloudSelectionFingerprint(file, connection);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, await cloudSelectionFingerprint({...file,name:'renamed.mp4'}, connection));
  for (const changed of [{...file,size:124},{...file,revision:'3'}]) assert.notEqual(first,await cloudSelectionFingerprint(changed,connection));
  assert.notEqual(first,await cloudSelectionFingerprint(file,'22222222-2222-4222-8222-222222222222'));
});
