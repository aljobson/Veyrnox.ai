import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-role-test' });
const jobs = await import('../app/api/v1/jobs/[id]/route.js');

const JOB = '11111111-1111-4111-8111-111111111111';
const get = (row) => {
    globalThis.fetch = async () => Response.json(row);
    return jobs.GET(new Request(`https://veyrnox.test/api/v1/jobs/${JOB}`, {
        headers: { 'x-veyrnox-auth-id': 'auth-user-1' },
    }), { params: Promise.resolve({ id: JOB }) });
};

test('a FAILED job reports failed and NOT refunded; REFUNDED reports both', async () => {
    const failed = await (await get({ ok: true, state: 'FAILED', credits: 28, model_id: 'm1', error_code: 'provider_failed' })).json();
    assert.equal(failed.state, 'failed');
    assert.equal(failed.refunded, false, 'job_failed does not refund; the refund is a second call');

    const refunded = await (await get({ ok: true, state: 'REFUNDED', credits: 28, model_id: 'm1' })).json();
    assert.equal(refunded.state, 'failed', 'the client keeps one state for its flow control');
    assert.equal(refunded.refunded, true);

    const stored = await (await get({ ok: true, state: 'STORED', credits: 28, model_id: 'm1' })).json();
    assert.equal(stored.refunded, false);
});

test('no surface claims a refund the ledger has not made', () => {
    const watcher = readFileSync(new URL('../app/veyrnox/_components/JobWatcher.js', import.meta.url), 'utf8');
    const create = readFileSync(new URL('../app/veyrnox/app/create/page.js', import.meta.url), 'utf8');
    const credits = readFileSync(new URL('../app/veyrnox/app/credits/page.js', import.meta.url), 'utf8');
    const library = readFileSync(new URL('../app/veyrnox/app/library/page.js', import.meta.url), 'utf8');
    const errors = readFileSync(new URL('../app/veyrnox/_lib/createErrors.js', import.meta.url), 'utf8');
    const grid = readFileSync(new URL('../app/veyrnox/_components/StudioJobGrid.js', import.meta.url), 'utf8');

    // Every "Credits refunded" is now behind the flag.
    assert.match(watcher, /next\.refunded \? `\$\{label\} failed\. Credits refunded\.`/);
    // The studio's failed-job copy lives in one helper that both the single
    // canvas and the multi-image grid render; neither keeps its own wording.
    assert.match(errors, /export function failedJobCopy\(job\) \{\s*return ERROR_COPY\[job\.error_code\]\s*\|\| \(job\.refunded\s*\? 'Something went wrong\. Credits refunded\.'\s*: 'Something went wrong\. Your credits are on their way back\.'\);/);
    for (const [name, src] of [['create', create], ['grid', grid]]) {
        assert.match(src, /\{failedJobCopy\(job\)\}/, name);
        assert.doesNotMatch(src, /Credits refunded\./, `${name} has its own refund wording`);
    }
    assert.match(credits, /refunded: j\.refunded === true/);
    assert.match(credits, /const isRefund = l\.state === 'failed' && l\.refunded === true;/);
    assert.match(library, /const refundPending = row\.state === 'failed' && row\.refunded === false;/);
    // And a pending refund shows no credit delta at all.
    assert.match(library, /row\.state === 'unknown' \|\| refundPending \? ''/);
});
