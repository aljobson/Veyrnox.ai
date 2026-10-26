import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SERVER_RENDER_PATH, serverResolution, serverRenderVisible, serverRenderDisabled, renderSnapshot,
    snapshotIdentity, quoteRequest, renderAttempt, sendRenderAttempt, renderStatus, renderPollDelay, renderPollOutcome, terminalRender,
    renderError, renderFeature, retryRenderTransport, renderLibraryHref, renderDownloadPath } from '../app/veyrnox/_lib/editorServerRenderClient.mjs';
import { EDITOR_EXPORT_HEIGHTS } from '../app/veyrnox/_lib/editorExportSettings.mjs';
import { documentForTimeline } from '../app/veyrnox/_lib/editorProject.mjs';
const ID = '11111111-1111-4111-8111-111111111111';
const timeline = JSON.parse(readFileSync(new URL('./fixtures/editorServerRender/v2.json', import.meta.url)));
const document = documentForTimeline({ project_id: ID, brief: '', canvas: { aspect_ratio: '16:9', frame_rate: 30 } }, timeline);
test('both UI gates must hold, inaccessible storage and missing mode fail closed', () => {
    let reads = 0;
    const yes = { getItem: key => { reads++; assert.equal(key, 'veyrnox_editor_server_render'); return '1'; } };
    for (const mode of ['off', false, true, undefined, 'true']) assert.equal(serverRenderVisible(mode, yes), false);
    assert.equal(reads, 0);
    for (const mode of ['preview', 'on']) {
        assert.equal(serverRenderVisible(mode, yes), true);
        for (const value of ['true', '0', null, undefined]) assert.equal(serverRenderVisible(mode, { getItem: () => value }), false);
        assert.equal(serverRenderVisible(mode, { getItem: () => { throw Error('blocked'); } }), false);
    }
});
test('every existing size is preserved or explicitly disabled; cloud document is required', () => {
    assert.deepEqual(EDITOR_EXPORT_HEIGHTS, [360, 480, 720, 1080, 1440, 2160]);
    for (const height of EDITOR_EXPORT_HEIGHTS) {
        const supported = [720, 1080].includes(height);
        assert.equal(serverResolution(height), supported ? `${height}p` : null);
        assert.equal(serverRenderDisabled(document, height, 'Edit'), supported ? null : 'supportedSizes');
        assert.equal(!!renderSnapshot(document, height, 'Edit'), supported);
    }
    for (const value of [null, {}, { schema_version: 2 }, { project_id: ID, schema_version: 1 }]) assert.equal(serverRenderDisabled(value, 720), 'saveFirst');
});
test('immutable save-document snapshot binds quote, body, size and label to one retry key', () => {
    const original = structuredClone(document), snapshot = renderSnapshot(original, 1080, 'My video');
    const identity = snapshotIdentity(snapshot), quote = { credits: 2, resolution: '1080p', seconds: 10.03, max_seconds: 120 };
    assert.deepEqual(JSON.parse(quoteRequest(snapshot).body), { document: snapshot.document, resolution: '1080p' });
    const attempt = renderAttempt(snapshot, quote, 'click-one');
    assert.deepEqual(JSON.parse(attempt.request.body), { document: snapshot.document, resolution: '1080p', label: 'My video', quoted_credits: 2 });
    original.brief = 'edited'; original.timeline.video[0].len = 1;
    assert.equal(snapshotIdentity(attempt.snapshot), identity);
    assert.throws(() => { attempt.snapshot.document.timeline.video[0].len = 3; }, TypeError);
    assert.equal(attempt.request.headers['Idempotency-Key'], 'click-one');
    const again = renderAttempt(snapshot, quote, 'click-two');
    assert.notEqual(again.key, attempt.key); assert.equal(again.request.body, attempt.request.body);
    for (const changed of [renderSnapshot(original, 1080, 'My video'), renderSnapshot(document, 720, 'My video'), renderSnapshot(document, 1080, 'Renamed')]) assert.notEqual(snapshotIdentity(changed), identity);
    assert.throws(() => renderAttempt(snapshot, { credits: '2', resolution: '1080p' }, 'key'));
    assert.throws(() => renderAttempt(snapshot, { credits: 2, resolution: '720p' }, 'key'));
    assert.equal(SERVER_RENDER_PATH, '/editor/server-render');
});
test('snapshot and disabled reason enforce the exact create label boundaries', () => {
    const invalid = [undefined, null, 12, {}, '', '  ', '\u00a0', 'a'.repeat(161), ' ' + 'a'.repeat(160)];
    for (const code of [...Array(32).keys(), 127]) invalid.push(`Name${String.fromCharCode(code)}`);
    for (const label of invalid) {
        assert.equal(serverRenderDisabled(document, 720, label), 'invalidName');
        assert.equal(renderSnapshot(document, 720, label), null);
    }
    for (const label of ['a', 'a'.repeat(160), ' My video ', '名前', '😀'.repeat(80)]) {
        assert.equal(serverRenderDisabled(document, 1080, label), null);
        assert.equal(renderSnapshot(document, 1080, label).label, label);
    }
    assert.equal(renderSnapshot(document, 720, '😀'.repeat(81)), null);
});
test('exact POST/DELETE and publicJob GET shapes normalize without inventing saving', () => {
    for (const state of ['SUBMITTED', 'running']) assert.equal(renderStatus({ job_id: ID, state, credits: 2 }).phase, 'rendering');
    for (const state of ['DEBITED', 'queued']) assert.equal(renderStatus({ job_id: ID, state }).phase, 'queued');
    const done = renderStatus({ job_id: ID, state: 'succeeded', refunded: false, render_id: ID, credits: 2, output_type: 'editor-render' });
    assert.equal(done.phase, 'done'); assert.equal(done.renderId, ID); assert.equal(terminalRender(done), true);
    assert.equal(renderStatus({ job_id: ID, state: 'STORED', idempotent: true }).phase, 'done');
    for (const response of [{ job_id: ID, state: 'REFUNDED' }, { job_id: ID, state: 'failed', refunded: true },
        { job_id: ID, state: 'REFUNDED', error: 'render_refunded', retry_with_new_key: true }]) {
        const job = renderStatus(response); assert.equal(job.phase, 'failed'); assert.equal(job.refunded, true);
    }
    assert.equal(renderStatus({ state: 'failed', refunded: false }).refunded, false);
});
test('polling starts at 3 seconds, backs off to 10, and stops for hidden/terminal states', () => {
    assert.equal(renderPollDelay(0, true, { phase: 'queued' }), 3000);
    assert.equal(renderPollDelay(3, true, { phase: 'rendering' }), 6000);
    assert.equal(renderPollDelay(100, true, { phase: 'rendering' }), 10000);
    assert.equal(renderPollDelay(0, false, { phase: 'rendering' }), null);
    for (const phase of ['done', 'failed']) assert.equal(renderPollDelay(0, true, { phase }), null);
});
test('status checks stop immediately for 403/404 and after five consecutive other failures', () => {
    for (const status of [403, 404]) {
        const result = renderPollOutcome(0, { status });
        assert.deepEqual(result, { failures: 1, statusUnavailable: true });
        assert.equal(renderPollDelay(0, true, { phase: 'rendering' }, result.statusUnavailable), null);
    }
    let result = renderPollOutcome(0);
    for (const status of [500, 429, undefined, 502, 400]) {
        result = renderPollOutcome(result.failures, { status });
        assert.equal(result.statusUnavailable, result.failures === 5);
        assert.equal(renderPollDelay(10, true, { phase: 'rendering' }, result.statusUnavailable), result.failures === 5 ? null : 10000);
    }
    // A successful read or explicit retry begins a fresh streak without changing the job.
    assert.deepEqual(renderPollOutcome(result.failures), { failures: 0, statusUnavailable: false });
    const reset = renderPollOutcome(4);
    assert.equal(renderPollOutcome(reset.failures, { status: 500 }).statusUnavailable, false);
});
test('errors use only known translation keys, feature names and existing Library delivery', () => {
    for (const [code, key] of Object.entries({ render_busy: 'busy', editor_render_unsupported: 'unsupported', editor_render_duration_limit: 'duration', editor_render_clip_limit: 'clips', editor_render_media_not_owned: 'ownership', editor_render_upload_incomplete: 'upload', insufficient_balance: 'balanceLow', rate_limited: 'rate', runner_submit_failed: 'submitFailed', render_invalid: 'invalid', render_too_large: 'tooLarge', render_refunded: 'refunded', preview_only: 'previewOnly', price_changed: 'priceChanged', job_finished: 'finished' })) assert.equal(renderError({ code }), `app.editor.server.${key}`);
    assert.equal(renderError({ status: 501 }), 'app.editor.server.disabled');
    assert.equal(renderError({ code: '<secret>', message: '<server text>' }), 'app.editor.server.failed');
    assert.equal(renderFeature('text.font'), 'app.editor.server.feature.text');
    assert.equal(renderFeature('<untrusted>'), 'app.editor.server.feature.edit');
    assert.equal(retryRenderTransport({ code: 'network_error' }), true);
    for (const code of ['render_refunded', 'price_changed', 'runner_submit_failed']) assert.equal(retryRenderTransport({ code }), false);
    assert.equal(renderLibraryHref(ID), `/app/library#render-${ID}`);
    assert.equal(renderDownloadPath(ID), `/library/editor-renders/${ID}/asset?download=1`);
});

test('network retry sends the frozen request twice; terminal failure or account change never retries', async () => {
    const snapshot = renderSnapshot(document, 720, 'Retry'), quote = { credits: 1, resolution: '720p' };
    const attempt = renderAttempt(snapshot, quote, 'one-click');
    const calls = [];
    const response = await sendRenderAttempt(async (path, request) => {
        calls.push({ path, request });
        if (calls.length === 1) throw { code: 'network_error' };
        return { job_id: ID, state: 'SUBMITTED', credits: 1, idempotent: true };
    }, attempt);
    assert.equal(response.job_id, ID); assert.equal(calls.length, 2);
    assert.strictEqual(calls[0].request, calls[1].request);
    assert.equal(calls[1].request.headers['Idempotency-Key'], 'one-click');
    for (const code of ['render_refunded', 'runner_submit_failed', 'insufficient_balance', 'price_changed']) {
        let count = 0;
        await assert.rejects(sendRenderAttempt(async () => { count++; throw { code }; }, attempt));
        assert.equal(count, 1);
    }
    let count = 0;
    await assert.rejects(sendRenderAttempt(async () => { count++; throw { code: 'network_error' }; }, attempt, () => false));
    assert.equal(count, 1);
});

test('an unreadable success remains a same-key retry, never a new paid attempt', async () => {
    const attempt = renderAttempt(renderSnapshot(document, 720, 'Edit'), { credits: 1, resolution: '720p' }, 'same-key');
    const calls = [];
    await assert.rejects(sendRenderAttempt(async (_path, request) => { calls.push(request); return null; }, attempt), { code: 'gateway_error' });
    assert.equal(calls.length, 2);
    assert.strictEqual(calls[0], calls[1]);
});
