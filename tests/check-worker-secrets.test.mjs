import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertPreserved, liveVersions, secretNames } from '../scripts/check-worker-secrets.mjs';

const version = (names) => ({ resources: { bindings: names.map((name) => ({ type: 'secret_text', name })) } });
test('missing pilot binding fails even when other secrets survive', () => {
    assert.throws(() => assertPreserved(['API_KEY', 'PUBLISH_TESTER_AUTH_IDS'], [version(['API_KEY'])]), /PUBLISH_TESTER_AUTH_IDS/);
});
test('plain text with the same name cannot replace a secret', () => {
    assert.throws(() => assertPreserved(['PILOT'], [{ resources: { bindings: [{ name: 'PILOT', type: 'plain_text', text: 'private value' }] } }]), /missing/);
    assert.deepEqual(secretNames(version(['PILOT'])), ['PILOT']);
});
test('all serving versions must preserve bindings, not just one side of a split', () => {
    assert.throws(() => assertPreserved(['PILOT'], [version(['PILOT']), version([])]), /missing/);
    assert.doesNotThrow(() => assertPreserved(['PILOT'], [version(['PILOT', 'NEW'])]));
});
test('unreadable metadata fails closed', () => {
    assert.throws(() => secretNames({}), /unavailable/);
    assert.throws(() => assertPreserved([], []), /unavailable/);
});
test('reads the latest deployment rather than newest uploaded version', async () => {
    const paths = [];
    const result = await liveVersions({ accountId: 'account', workerName: 'worker', token: 'not-logged', fetchImpl: async (url) => {
        paths.push(url);
        return { ok: true, json: async () => ({ success: true, result: url.endsWith('/deployments')
            ? { deployments: [{ created_on: '2026-01-01', versions: [{ version_id: 'old', percentage: 100 }] },
                { created_on: '2026-10-09', versions: [{ version_id: 'live', percentage: 100 }, { version_id: 'inactive', percentage: 0 }] }] }
            : version(['PILOT']) }) };
    } });
    assert.equal(paths.length, 2);
    assert.ok(paths[1].endsWith('/versions/live'));
    assertPreserved(['PILOT'], result);
});
