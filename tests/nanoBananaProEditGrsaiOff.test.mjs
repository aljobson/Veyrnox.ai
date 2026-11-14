import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { submitTask, EDIT_ENDPOINT } from '../packages/adapters/grsai.js';
import { publicModelName } from '../lib/publicCatalog.js';

const sql = readFileSync('packages/db/schema/supabase/0512_nano_banana_pro_edit_grsai_off.sql', 'utf8');
const editJob = {
    provider_endpoint: EDIT_ENDPOINT,
    inputs: { prompt: 'Make it night time with a full moon', aspect_ratio: '9:16', image_url: 'https://r2.example/ref.png' },
};

async function withFetch(fn, run) {
    const real = globalThis.fetch;
    globalThis.fetch = fn;
    try { await run(); } finally { globalThis.fetch = real; }
}

test('the QA F01 edit request is well formed: one reference in urls, 9:16, pinned 2K model', async () => {
    let sent;
    await withFetch(async (_url, init) => { sent = JSON.parse(init.body); return Response.json({ code: 0, data: { id: '7-ok' } }); }, async () => {
        assert.deepEqual(await submitTask(editJob, { apiKey: 'k' }), { ok: true, providerJobId: '7-ok' });
    });
    assert.deepEqual(sent.urls, ['https://r2.example/ref.png']);
    assert.equal(sent.aspectRatio, '9:16');
    assert.equal(sent.model, 'nano-banana-pro');
    assert.equal(sent.imageSize, '2K');
});

test('an empty GrsAI balance refuses the edit at submit, so the row must be off while it lasts', async () => {
    await withFetch(async () => Response.json({ code: -1, msg: 'insufficient credits' }), async () => {
        const r = await submitTask(editJob, { apiKey: 'k' });
        assert.equal(r.ok, false);
        assert.equal(r.error, 'provider_payment_required');
    });
});

test('0512 switches off only the GrsAI edit row, asserts one row, and leaves the fal edit alone', () => {
    assert.match(sql, /SET active = false,/);
    assert.match(sql, /WHERE id = 'nano-banana-pro-edit-grsai' AND provider = 'grsai'/);
    assert.match(sql, /GET DIAGNOSTICS affected = ROW_COUNT;\s*IF affected <> 1 THEN/);
    assert.doesNotMatch(sql, /id = 'nano-banana-pro-edit'(?!-)/, 'the 9-credit fal row is not touched');
    assert.doesNotMatch(sql, /credits_5s\s*=\s*\d+\s*,/, 'no price change');
    assert.doesNotMatch(sql, /INSERT|DELETE/i);
});

test('the two edit rows have distinct public names', () => {
    const lite = sql.match(/name = '([^']+)'/)[1];
    assert.equal(publicModelName(lite), 'Nano Banana Pro Edit Lite');
    assert.notEqual(publicModelName(lite), publicModelName('Nano Banana Pro Edit'));
});
