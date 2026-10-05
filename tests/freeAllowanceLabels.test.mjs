import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Page and card sources are read, like createImageCount.test.mjs: they are client components.
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const create = read('../app/veyrnox/app/create/page.js');
const library = read('../app/veyrnox/app/library/page.js');
const migration = read('../packages/db/schema/supabase/0207_reconcile_includes_free_allowance.sql');
const prior = read('../packages/db/schema/supabase/0184_subscription_credit_cycle.sql');

test('a job the server marked free is recorded at 0 credits, in the studio and in the history', () => {
    assert.match(create, /const jobCredits = submitted\.free_allowance === true \? 0 : unitCost;/);
    assert.match(create, /credits: jobCredits, model_id: modelId/);
    assert.equal((create.match(/credits: jobCredits,/g) || []).length, 2, 'history and studio job both use it');
});

test('the Library says FREE for a 0-credit job and never a refund line for a failed one', () => {
    assert.match(library, /const free = row\.credits === 0;/);
    assert.match(library, /free \? \(row\.state === 'failed' \? '' : 'FREE'\)/);
    // A paid job keeps its signed delta exactly as before.
    assert.match(library, /row\.state === 'failed' \? `\+\$\{row\.credits\}` : `−\$\{row\.credits\}`/);
});

test('0207 keeps the five existing reconcile checks and adds the free-allowance one', () => {
    const body = (src) => src.slice(src.indexOf('$cmd$'), src.lastIndexOf('$cmd$'));
    const before = body(prior), after = body(migration);
    for (const fn of ['reconcile_balances', 'reconcile_free_credits', 'reconcile_top_ups', 'reconcile_failed_refunds', 'reconcile_subscription_credits']) {
        assert.ok(before.includes(fn) && after.includes(fn), fn);
    }
    assert.ok(after.includes('reconcile_free_allowance()') && !before.includes('reconcile_free_allowance'));
    assert.match(after, /OR s > 0 OR a > 0 THEN/);
    assert.match(migration, /'17 3 \* \* \*'/, 'same schedule as 0184');
});
