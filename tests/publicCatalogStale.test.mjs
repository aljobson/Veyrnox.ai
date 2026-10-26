import test from 'node:test';
import assert from 'node:assert/strict';
import { readPublicCatalog, CATALOG_TTL_SECONDS, _resetPublicCatalogRefresh } from '../lib/publicCatalog.js';

const row = { id: 'demucs-stems', name: 'Demucs', modality: 'audio-to-audio', credits_5s: 6, provider_endpoint: 'fal-ai/demucs', gated_flag: false };
const cfg = { supabaseUrl: 'https://test.invalid', serviceRoleKey: 'test-only' };

function withCache(run) {
    return async () => {
        const old = globalThis.caches;
        const store = new Map();
        globalThis.caches = { default: { match: async (k) => store.get(k)?.clone(), put: async (k, r) => store.set(k, r.clone()) } };
        try { await run(store); } finally { if (old === undefined) delete globalThis.caches; else globalThis.caches = old; }
    };
}

test('an outage serves the saved price list, however old', withCache(async (store) => {
    await readPublicCatalog({ cfg, selectRows: async () => [row] });
    const [key, saved] = [...store.entries()][0];
    // Age the copy past the 5-minute window, as Supabase going down would.
    const aged = new Response(await saved.clone().text(), { headers: { 'Content-Type': 'application/json', 'X-Fetched-At': String(Date.now() - (CATALOG_TTL_SECONDS + 60) * 1000) } });
    store.set(key, aged);

    let tries = 0;
    const models = await readPublicCatalog({ cfg, selectRows: async () => { tries++; throw new Error('supabase down'); } });
    assert.equal(tries, 1, 'it still tried the database first');
    assert.equal(models.length, 1);
    assert.equal(models[0].id, 'demucs-stems');
}));

test('a fresh copy is served without asking the database, and with no copy an outage still throws', withCache(async () => {
    await readPublicCatalog({ cfg, selectRows: async () => [row] });
    const models = await readPublicCatalog({ cfg, selectRows: async () => { throw new Error('must not be called'); } });
    assert.equal(models.length, 1);
}));

test('with nothing saved, an outage is still an error for the caller to handle', withCache(async () => {
    await assert.rejects(readPublicCatalog({ cfg, selectRows: async () => { throw new Error('supabase down'); } }), /supabase down/);
}));

test('flag changes partition fresh caches and clamp an enabled stale fallback during an outage', withCache(async () => {
    const previous = process.env.MULTI_REFERENCE_ENABLED;
    const edit = { ...row, id: 'edit', provider_endpoint: 'fal-ai/nano-banana-pro/edit' };
    try {
        process.env.MULTI_REFERENCE_ENABLED = 'true';
        assert.equal((await readPublicCatalog({ cfg, selectRows: async () => [edit] }))[0].capabilities.media.image.maxFiles, 3);
        process.env.MULTI_REFERENCE_ENABLED = 'false';
        assert.equal((await readPublicCatalog({ cfg, selectRows: async () => { throw Error('offline'); } }))[0].capabilities.media.image.maxFiles, 1);
        let reads = 0;
        assert.equal((await readPublicCatalog({ cfg, selectRows: async () => { reads++; return [edit]; } }))[0].capabilities.media.image.maxFiles, 1);
        assert.equal(reads, 1);
    } finally { if (previous === undefined) delete process.env.MULTI_REFERENCE_ENABLED; else process.env.MULTI_REFERENCE_ENABLED = previous; }
}));

test('past the window the stale list is served at once and refreshed after the response', withCache(async (store) => {
    _resetPublicCatalogRefresh();
    await readPublicCatalog({ cfg, selectRows: async () => [row] });
    const [key, saved] = [...store.entries()][0];
    store.set(key, new Response(await saved.clone().text(), { headers: { 'Content-Type': 'application/json', 'X-Fetched-At': String(Date.now() - (CATALOG_TTL_SECONDS + 60) * 1000) } }));

    const background = [];
    let reads = 0;
    let release;
    const gate = new Promise((r) => { release = r; });
    const selectRows = async () => { reads++; await gate; return [{ ...row, name: 'Demucs v2' }]; };
    const waitUntil = (work) => background.push(work);

    const [a, b] = await Promise.all([
        readPublicCatalog({ cfg, selectRows, waitUntil }),
        readPublicCatalog({ cfg, selectRows, waitUntil }),
    ]);
    assert.equal(a[0].name, 'Demucs', 'the visitor did not wait for the database');
    assert.equal(b[0].name, 'Demucs');
    assert.equal(background.length, 1, 'a burst on a stale copy makes one refresh');

    release();
    await Promise.all(background);
    assert.equal(reads, 1);
    const fresh = await readPublicCatalog({ cfg, selectRows: async () => { throw new Error('must not be called'); }, waitUntil });
    assert.equal(fresh[0].name, 'Demucs v2', 'the next visitor gets the refreshed list');
}));

test('a failed background refresh keeps the saved list and is not an unhandled rejection', withCache(async (store) => {
    _resetPublicCatalogRefresh();
    await readPublicCatalog({ cfg, selectRows: async () => [row] });
    const [key, saved] = [...store.entries()][0];
    store.set(key, new Response(await saved.clone().text(), { headers: { 'Content-Type': 'application/json', 'X-Fetched-At': String(Date.now() - (CATALOG_TTL_SECONDS + 60) * 1000) } }));

    const background = [];
    const models = await readPublicCatalog({ cfg, selectRows: async () => { throw new Error('supabase down'); }, waitUntil: (w) => background.push(w) });
    assert.equal(models.length, 1);
    await Promise.all(background);
}));
