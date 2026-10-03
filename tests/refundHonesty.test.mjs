import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

// createErrors.js takes one string from the gateway client; the copy under
// test needs none of the client itself.
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
    if (s === './gateway') return { url: 'data:text/javascript,export const ACCOUNT_PAUSED_COPY = "";', shortCircuit: true };
    return next(s === 'next/server' ? 'next/server.js' : s, c);
}`));
Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-role-test' });
const jobs = await import('../app/api/v1/jobs/[id]/route.js');
const { STATE_UI, jobStateUi } = await import('../app/veyrnox/_lib/studioStates.js');
const { ERROR_COPY, failedJobCopy } = await import('../app/veyrnox/_lib/createErrors.js');

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

test('the studio state label says REFUNDED only once /jobs/:id reports the refund', async () => {
    // What the route answers for each ledger state, read the way the studio reads it.
    const failed = await (await get({ ok: true, state: 'FAILED', credits: 28, model_id: 'm1', error_code: 'provider_error' })).json();
    const refunded = await (await get({ ok: true, state: 'REFUNDED', credits: 28, model_id: 'm1', error_code: 'provider_error' })).json();
    assert.equal(jobStateUi(failed).label, 'FAILED · REFUND PENDING');
    assert.equal(jobStateUi(refunded).label, 'FAILED · REFUNDED');

    // Anything short of `true` is not a refund: a job not polled yet, a reply
    // without the field, a stray truthy value.
    for (const flag of [false, undefined, null, 'true', 1]) {
        assert.doesNotMatch(jobStateUi({ state: 'failed', refunded: flag }).label, /REFUNDED/, String(flag));
    }
    // The colour-blind glyph and the danger tone hold either way.
    for (const job of [failed, refunded]) {
        assert.deepEqual([jobStateUi(job).glyph, jobStateUi(job).tone], ['✕', 'danger']);
    }
    // Looked up by state alone, no entry can claim a refund.
    for (const [state, ui] of Object.entries(STATE_UI)) {
        assert.doesNotMatch(ui.label, /REFUNDED/, state);
    }
    // The flag only ever changes a failed job's label.
    assert.equal(jobStateUi({ state: 'succeeded', refunded: true }).label, 'DONE');
    assert.equal(jobStateUi({ state: 'running' }).label, 'RUNNING');
});

test('a failed job\'s body copy claims the refund only once it has landed, whatever the error code', () => {
    for (const code of [...Object.keys(ERROR_COPY), 'a_code_with_no_copy', undefined]) {
        for (const flag of [false, undefined]) {
            assert.doesNotMatch(failedJobCopy({ state: 'failed', error_code: code, refunded: flag }), /refunded/i,
                `${code} claims a refund that has not landed`);
        }
    }
    assert.equal(failedJobCopy({ error_code: 'provider_error', refunded: false }),
        'The model returned an error. Your credits are on their way back.');
    assert.equal(failedJobCopy({ error_code: 'provider_timeout', refunded: false }),
        'The model took too long. Your credits are on their way back — try again.');
    assert.equal(failedJobCopy({ error_code: 'provider_error', refunded: true }), ERROR_COPY.provider_error);
    assert.equal(failedJobCopy({ refunded: false }), 'Something went wrong. Your credits are on their way back.');
    assert.equal(failedJobCopy({ refunded: true }), 'Something went wrong. Credits refunded.');
});

test('no surface claims a refund the ledger has not made', () => {
    const watcher = readFileSync(new URL('../app/veyrnox/_components/JobWatcher.js', import.meta.url), 'utf8');
    const create = readFileSync(new URL('../app/veyrnox/app/create/page.js', import.meta.url), 'utf8');
    const credits = readFileSync(new URL('../app/veyrnox/app/credits/page.js', import.meta.url), 'utf8');
    const library = readFileSync(new URL('../app/veyrnox/app/library/page.js', import.meta.url), 'utf8');
    const grid = readFileSync(new URL('../app/veyrnox/_components/StudioJobGrid.js', import.meta.url), 'utf8');

    // Every "Credits refunded" is now behind the flag.
    assert.match(watcher, /next\.refunded \? `\$\{label\} failed\. Credits refunded\.`/);
    // The studio's failed-job label and copy each live in one helper that both
    // the single canvas and the multi-image grid render; neither keeps its own
    // wording, and neither reads a label by state alone.
    for (const [name, src] of [['create', create], ['grid', grid]]) {
        assert.match(src, /\{failedJobCopy\(job\)\}/, name);
        assert.doesNotMatch(src, /Credits refunded\./, `${name} has its own refund wording`);
        assert.match(src, /jobStateUi\(job\)/, name);
        assert.doesNotMatch(src, /REFUNDED|STATE_UI/, `${name} has its own state label`);
    }
    assert.match(credits, /refunded: j\.refunded === true/);
    assert.match(credits, /const isRefund = l\.state === 'failed' && l\.refunded === true;/);
    // The Library keeps its own table but the same rule and the same words.
    assert.match(library, /const refundPending = row\.state === 'failed' && row\.refunded !== true;/);
    assert.ok(library.includes(`failed_pending: { chip: 'danger', glyph: '✕', label: '${STATE_UI.failed.label}' }`));
    // And a pending refund shows no credit delta at all.
    assert.match(library, /row\.state === 'unknown' \|\| refundPending \? ''/);
});
