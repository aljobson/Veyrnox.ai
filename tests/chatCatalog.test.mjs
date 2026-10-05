// ADR-0067: Chat models stay out of the public media catalog, and Chat ships closed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readPublicCatalog } from '../lib/publicCatalog.js';

test('the public catalog read excludes text models', async () => {
    let seen;
    const selectRows = async (table, q) => { seen = { table, q }; return []; };
    await readPublicCatalog({ cfg: { supabaseUrl: 'https://x.test', serviceRoleKey: 'k' }, selectRows });
    assert.equal(seen.table, 'model_catalog');
    assert.match(seen.q.filter, /(^|&)modality=neq\.text(&|$)/);
    assert.match(seen.q.filter, /(^|&)active=eq\.true(&|$)/);
});

test('wrangler ships CHAT_ENABLED as the string "false" in production vars', () => {
    const text = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
    const vars = text.slice(text.indexOf('"vars"'));
    const production = vars.slice(0, vars.indexOf('"env"') > 0 ? vars.indexOf('"env"') : undefined);
    assert.match(production, /"CHAT_ENABLED":\s*"false"/);
    assert.doesNotMatch(production, /"CHAT_ENABLED":\s*"true"/);
});
