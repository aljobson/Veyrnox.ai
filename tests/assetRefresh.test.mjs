import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAssetRefresher } from '../app/veyrnox/_lib/assetRefresh.js';

const URL = 'https://media.test/fresh?signature=test';
function harness(overrides = {}) {
    let time = 1000;
    const calls = [], updates = [];
    const refresher = createAssetRefresher({
        jobId: 'job-1', now: () => time,
        fetchAsset: async (id) => { calls.push(id); return { url: URL, expires_in: 900 }; },
        onChange: (patch) => updates.push(patch), ...overrides,
    });
    return { ...refresher, calls, updates, advance: (ms) => { time += ms; } };
}

test('a media error fetches a fresh URL for the same job and clears loading', async () => {
    const h = harness();
    await h.refresh();
    assert.deepEqual(h.calls, ['job-1']);
    assert.deepEqual(h.updates, [
        { loading: true, error: null }, { url: URL, loading: false, error: null },
    ]);
});

test('simultaneous error events share one signing request', async () => {
    let resolve, count = 0;
    const h = harness({ fetchAsset: () => { count++; return new Promise((r) => { resolve = r; }); } });
    const first = h.refresh();
    assert.equal(h.refresh(), first);
    await Promise.resolve();
    assert.equal(count, 1);
    resolve({ url: URL, expires_in: 900 });
    await first;
});

test('a fresh URL failing does not loop; automatic renewal resumes only after its lifetime', async () => {
    const h = harness();
    await h.refresh();
    for (let i = 0; i < 20; i++) await h.refresh();
    assert.equal(h.calls.length, 1);
    assert.equal(h.updates.at(-1).error, 'Could not load this file. Try again.');
    h.advance(899999); await h.refresh(); assert.equal(h.calls.length, 1);
    h.advance(1); await h.refresh(); assert.equal(h.calls.length, 2);
});

test('uses the endpoint TTL, with a bounded default if it is missing', async () => {
    for (const [expires_in, wait] of [[10, 10000], [undefined, 900000], [-1, 900000], [Infinity, 900000], [3600, 900000]]) {
        let count = 0;
        const h = harness({ fetchAsset: async () => { count++; return { url: URL, expires_in }; } });
        await h.refresh(); h.advance(wait - 1); await h.refresh(); assert.equal(count, 1);
        h.advance(1); await h.refresh(); assert.equal(count, 2);
    }
});

test('404, expired auth and offline failures stop automatically and expose useful copy', async () => {
    for (const [status, message] of [[404, 'This file is no longer available.'], [401, 'Sign in again to load this file.'], [503, 'Could not load this file. Try again.']]) {
        let count = 0;
        const h = harness({ fetchAsset: async () => { count++; throw Object.assign(new Error('private upstream detail'), { status }); } });
        await h.refresh();
        assert.deepEqual(h.updates.at(-1), { loading: false, error: message });
        await h.refresh(); h.advance(3600000); await h.refresh();
        assert.equal(count, 1);
        assert.equal(h.updates.at(-1).error, message);
        assert.equal(JSON.stringify(h.updates).includes('private upstream detail'), false);
    }
});

test('successful media load clears the banner without resetting the retry budget', async () => {
    const h = harness();
    await h.refresh(); await h.refresh();
    assert.ok(h.updates.at(-1).error);
    h.loaded(); assert.equal(h.updates.at(-1).error, null);
    await h.refresh(); assert.equal(h.calls.length, 1);
});

test('explicit retry can recover after a failed signing request', async () => {
    let count = 0;
    const h = harness({ fetchAsset: async () => { if (++count === 1) throw new Error('offline'); return { url: URL, expires_in: 900 }; } });
    await h.refresh(); await h.refresh(true);
    assert.equal(count, 2);
    assert.equal(h.updates.at(-1).url, URL);
    assert.equal(h.updates.at(-1).error, null);
});

test('invalid signing responses never replace the media URL or automatically retry', async () => {
    for (const value of [null, {}, { url: 'javascript:bad' }, { url: '' }]) {
        let count = 0;
        const h = harness({ fetchAsset: async () => { count++; return value; } });
        await h.refresh(); await h.refresh();
        assert.equal(count, 1);
        assert.equal(h.updates.some((u) => 'url' in u), false);
    }
});

test('unmount or changing jobs suppresses late results and stops future work', async () => {
    let resolve;
    const h = harness({ fetchAsset: () => new Promise((r) => { resolve = r; }) });
    const pending = h.refresh();
    await Promise.resolve(); h.dispose(); resolve({ url: URL }); await pending;
    assert.deepEqual(h.updates, [{ loading: true, error: null }]);
    await h.refresh(true);
    assert.equal(h.updates.length, 1);
    const early = harness(); const earlyPending = early.refresh(); early.dispose(); await earlyPending;
    assert.equal(early.calls.length, 0);
});

test('Library, Create and Clip Editor wire all media errors to recovery and expose retry', () => {
    const read = (path) => readFileSync(new globalThis.URL(path, import.meta.url), 'utf8');
    const library = read('../app/veyrnox/app/library/page.js');
    const preview = read('../app/veyrnox/_components/JobAssetPreview.js');
    const sheet = read('../app/veyrnox/_components/EditSheet.js');
    for (const [source, count] of [[library, 3], [preview, 3], [sheet, 1]]) {
        assert.equal((source.match(/onError=\{asset.onError\}/g) || []).length, count);
        assert.match(source, /<AssetLoadStatus asset=\{asset\}/);
    }
    assert.match(read('../app/veyrnox/app/create/page.js'), /<JobAssetPreview job=\{job\}/);
    const hook = read('../app/veyrnox/_lib/useAssetUrl.js');
    assert.match(hook, /gatewayFetch\(`\/jobs\/\$\{encodeURIComponent\(id\)\}\/asset`\)/);
    assert.match(hook, /refresher.dispose\(\)/);
    assert.doesNotMatch(hook, /localStorage|setInterval/);
    assert.match(read('../app/veyrnox/_components/AssetLoadStatus.js'), /onClick=\{asset.retry\}/);
});
