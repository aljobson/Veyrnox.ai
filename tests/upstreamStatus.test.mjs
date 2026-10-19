import test from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseError } from '../packages/db/supabase-client.js';
import {
    STATUS_TTL_MS, _resetUpstreamStatus, currentStatus, isOutageError, probeDatabase,
} from '../lib/upstreamStatus.js';
import { readStatus, nextPollDelay, POLL_OK_MS, POLL_DEGRADED_MS } from '../app/veyrnox/_lib/serviceStatus.js';

const cfg = { supabaseUrl: 'https://test.invalid', serviceRoleKey: 'test-only' };
const noSleep = async () => {};

test('a missing response, a timeout and a 5xx are an outage; a 4xx is ours to fix, not an outage', () => {
    assert.equal(isOutageError(new SupabaseError('x', { status: 0, body: null })), true);
    assert.equal(isOutageError(new SupabaseError('x', { status: 503, body: null })), true);
    assert.equal(isOutageError(new SupabaseError('x', { status: 522, body: null })), true);
    assert.equal(isOutageError(new SupabaseError('x', { status: 401, body: null })), false);
    assert.equal(isOutageError(new SupabaseError('x', { status: 404, body: null })), false);
    assert.equal(isOutageError(new TypeError('fetch failed')), true);
});

test('the probe is ok when the read works, and degraded only after the retry also fails', async () => {
    let calls = 0;
    assert.equal(await probeDatabase(cfg, { selectRows: async () => { calls++; return [{ id: 'm' }]; }, sleep: noSleep }), 'ok');
    assert.equal(calls, 1);

    calls = 0;
    const down = async () => { calls++; throw new SupabaseError('x', { status: 0, body: null }); };
    assert.equal(await probeDatabase(cfg, { selectRows: down, sleep: noSleep }), 'degraded');
    assert.equal(calls, 2, 'one retry, so a dropped packet is not a banner');

    calls = 0;
    const blip = async () => { if (++calls === 1) throw new SupabaseError('x', { status: 0, body: null }); return []; };
    assert.equal(await probeDatabase(cfg, { selectRows: blip, sleep: noSleep }), 'ok');
});

test('a refusal that is not an outage reports ok', async () => {
    const refused = async () => { throw new SupabaseError('x', { status: 401, body: null }); };
    assert.equal(await probeDatabase(cfg, { selectRows: refused, sleep: noSleep }), 'ok');
});

test('status is unknown without a configured database, and probes are shared inside the window', async () => {
    _resetUpstreamStatus();
    assert.equal((await currentStatus({ cfg: {} })).status, 'unknown');

    let probes = 0;
    let clock = 1_000_000;
    const args = { cfg, now: () => clock, probe: async () => { probes++; return 'degraded'; } };
    const [a, b] = await Promise.all([currentStatus(args), currentStatus(args)]);
    assert.equal(a.status, 'degraded');
    assert.equal(b.status, 'degraded');
    assert.equal(probes, 1, 'concurrent callers share one probe');

    await currentStatus(args);
    assert.equal(probes, 1, 'a second look inside the window reuses it');

    clock += STATUS_TTL_MS + 1;
    await currentStatus({ ...args, probe: async () => { probes++; return 'ok'; } });
    assert.equal(probes, 2, 'past the window it probes again');
    _resetUpstreamStatus();
});

test('the banner only shows for an explicit degraded answer and polls faster while it shows', () => {
    assert.equal(readStatus({ status: 'degraded' }), 'degraded');
    for (const body of [{ status: 'ok' }, { status: 'unknown' }, {}, null, 'degraded', [], { status: 'DEGRADED' }]) {
        assert.equal(readStatus(body), 'ok');
    }
    assert.equal(nextPollDelay('ok'), POLL_OK_MS);
    assert.equal(nextPollDelay('degraded'), POLL_DEGRADED_MS);
    assert.ok(POLL_DEGRADED_MS < POLL_OK_MS);
});
