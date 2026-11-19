import test from 'node:test';
import assert from 'node:assert/strict';
import { sweepRows, ROTATION_SPAN } from '../lib/sweepRows.js';
import { sweepByteplus, BATCH } from '../lib/byteplusSweep.js';

const cfg = { supabaseUrl: 'https://db.test', serviceRoleKey: 'svc' };
const BASE = 'provider=eq.byteplus&state=in.(SUBMITTED)';
const OLDEST = Math.ceil(BATCH / 2);
const ROTATING = BATCH - OLDEST;

/** A table of n pending jobs, oldest first, served the way PostgREST serves limit and offset. */
function withTable(n, run, { open = () => true } = {}) {
    const real = globalThis.fetch;
    const urls = [];
    const rows = Array.from({ length: n }, (_, i) => ({ id: `job-${String(i).padStart(5, '0')}`, user_id: 'u', credits: 29, state: 'SUBMITTED', provider_job_id: `task-${i}`, created_at: `2026-11-19T10:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z`, i }));
    globalThis.fetch = async (url) => {
        const u = new URL(url); urls.push(u);
        const offset = Number(u.searchParams.get('offset') || 0);
        const limit = Number(u.searchParams.get('limit') || 1000);
        return Response.json(rows.filter(open).slice(offset, offset + limit));
    };
    return Promise.resolve(run(urls, rows)).finally(() => { globalThis.fetch = real; });
}

const minuteAt = (m) => new Date(m * 60_000);

test('a one-job check asks for that job alone, with no rotating window', async () => {
    await withTable(10, async (urls) => {
        await sweepRows({ columns: 'id', filter: `${BASE}&id=eq.job-00003`, only: '&id=eq.job-00003', cfg, batch: BATCH });
        assert.equal(urls.length, 1);
        assert.equal(urls[0].searchParams.get('limit'), String(BATCH));
        assert.equal(urls[0].searchParams.get('offset'), null);
    });
});

test('when everything fits in the oldest block it makes one read and returns it all', async () => {
    await withTable(OLDEST - 1, async (urls) => {
        const out = await sweepRows({ columns: 'id', filter: BASE, cfg, batch: BATCH });
        assert.equal(out.length, OLDEST - 1);
        assert.equal(urls.length, 1);
        assert.equal(urls[0].searchParams.get('order'), 'created_at.asc');
    });
});

test('a full oldest block adds a window behind it that moves on each minute and wraps', async () => {
    await withTable(2000, async (urls) => {
        const offsets = [];
        for (const m of [1000, 1001, 1002]) {
            urls.length = 0;
            const out = await sweepRows({ columns: 'id', filter: BASE, now: minuteAt(m), cfg, batch: BATCH });
            assert.equal(out.length, BATCH, 'the same number of reads as the old batch');
            assert.equal(new Set(out.map((r) => r.id)).size, BATCH, 'no job twice');
            offsets.push(Number(urls[1].searchParams.get('offset')));
        }
        assert.deepEqual(offsets, [0, 1, 2].map((k) => OLDEST + (((1000 + k) * ROTATING) % ROTATION_SPAN)));
        assert.equal(offsets[1] - offsets[0] === ROTATING || offsets[1] < offsets[0], true, 'it advances by one window, or wraps');
    });
});

test('a window past the end of the table falls back to the rows right behind the oldest block', async () => {
    await withTable(OLDEST + 5, async (urls) => {
        const out = await sweepRows({ columns: 'id', filter: BASE, now: minuteAt(7), cfg, batch: BATCH });
        assert.equal(out.length, OLDEST + 5);
        assert.equal(Number(urls.at(-1).searchParams.get('offset')), OLDEST);
    });
});

test('finished jobs behind a block of rendering ones are reached, where the old oldest-50 read settled nothing', async () => {
    const stuck = 60;            // the oldest 60 are still rendering at the provider
    const total = 300;
    const settled = new Set();
    const closed = new Set();
    await withTable(total, async () => {
        const r2cfg = { accountId: 'a', accessKeyId: 'k', secretAccessKey: 's', bucket: 'b' };
        // The catalog query and the jobs queries both go through the same fetch; give the catalog its row.
        const inner = globalThis.fetch;
        globalThis.fetch = async (url) => {
            if (new URL(url).pathname.endsWith('/model_catalog')) return Response.json([{ id: 'm', provider_endpoint: 'byteplus:seedance-2.0-fast' }]);
            return inner(url);
        };
        for (let m = 0; m < 12; m++) {
            await sweepByteplus({ cfg, r2cfg, apiKey: 'k', now: minuteAt(5000 + m),
                read: async (taskId) => (Number(taskId.slice(5)) < stuck ? { ok: true, state: 'pending' } : { ok: true, state: 'success', outputUrl: 'https://p.test/x.mp4' }),
                complete: async ({ job }) => { settled.add(job.id); closed.add(job.id); return { status: 200, body: {} }; } });
        }
    }, { open: (r) => !closed.has(r.id) });
    assert.ok(settled.size > 0, `settled ${settled.size}`);
});
