import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// JSX page, so this reads the source, like authGateLifecycle.test.mjs.
const page = readFileSync(new URL('../app/veyrnox/app/create/page.js', import.meta.url), 'utf8');

test('?model= fallback waits for the live catalog', () => {
    // useCatalog starts from the tokens.js list. A model only the live
    // catalog knows (veo-3.1-lite-kie, 2026-09-21) was reset to the first
    // open model before /api/catalog answered, and the job ran on wan-2.5.
    const start = page.indexOf("isn't in the (live or fallback) catalog");
    const effect = page.slice(start, page.indexOf('}, [', start));
    assert.ok(start > 0, 'fallback effect not found');
    assert.match(effect, /if \(catalogLoading \|\| !models\.length\) return;/);
});
