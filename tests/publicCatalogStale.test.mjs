import test from 'node:test';
import assert from 'node:assert/strict';
import { readPublicCatalog, CATALOG_TTL_SECONDS } from '../lib/publicCatalog.js';

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
