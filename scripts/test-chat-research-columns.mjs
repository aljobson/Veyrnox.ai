#!/usr/bin/env node
// 0208 and 0214 (ADR-0070): the Deep research columns, their rules, and the one row priced for it. Runs against the full migration
// replay (ledger-tests.yml).
// Every fixture is rolled back.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const c = new pg.Client({ connectionString: url });
await c.connect();
const one = async (sql, args = []) => (await c.query(sql, args)).rows[0];
const refused = async (sql, args, code) => {
    await c.query('SAVEPOINT r');
    try { await c.query(sql, args); assert.fail(`expected ${code}`); }
    catch (err) { assert.equal(err.code, code, err.message); }
    finally { await c.query('ROLLBACK TO SAVEPOINT r'); }
};

try {
    const m208 = await readFile(new URL('../packages/db/schema/supabase/0208_chat_research_columns.sql', import.meta.url), 'utf8');
    const m209 = await readFile(new URL('../packages/db/schema/supabase/0214_chat_research_pricing.sql', import.meta.url), 'utf8');
    await c.query('BEGIN'); for (const m of [m208, m209, m208, m209]) await c.query(m); await c.query('ROLLBACK'); // safe to apply, and to replay

    await c.query('BEGIN');
    const id = `research-test-${randomUUID().slice(0, 8)}`;
    const insert = (modality, credits, cost, cap, search = 'cheap/search') => c.query(
        `INSERT INTO public.model_catalog (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, active,
            chat_research_extra_credits, chat_research_extra_cost, chat_research_write_max_tokens, chat_research_search_model)
         VALUES ($1, $1, 'openrouter-chat', 'test/model', $2, 1, 0.0020, 'per_generation', false, $3, $4, $5, $6)`, [id + modality + String(credits), modality, credits, cost, cap, search]);

    // Exactly one row offers research after 0214, with the measured price, the write cap and the search model.
    const offering = (await c.query(`SELECT id, chat_research_extra_credits AS credits, chat_research_extra_cost::float AS cost, chat_research_write_max_tokens AS cap,
        chat_research_search_model AS search FROM public.model_catalog WHERE chat_research_extra_credits IS NOT NULL OR chat_research_extra_cost IS NOT NULL
        OR chat_research_write_max_tokens IS NOT NULL OR chat_research_search_model IS NOT NULL`)).rows;
    assert.deepEqual(offering, [{ id: 'chat-claude-sonnet-5.5', credits: 3, cost: 0.04, cap: 4096, search: 'mistralai/mistral-small-2603' }]);
    // 3 Credits clears the margin floor for the recorded cost, and the whole reply (base 4 + 3) clears it for the worst whole run.
    assert.ok(3 >= Math.ceil(0.04 / 0.01796));
    assert.ok(4 + 3 >= Math.ceil(0.087 / 0.01796));
    await insert('text', null, null, null, null);

    // A valid trio: $0.29 at the floor is ceil(0.29 / 0.01796) = 17 Credits.
    await insert('text', 17, 0.29, 4096);
    // The floor is enforced: 16 Credits is under it.
    await refused(`INSERT INTO public.model_catalog (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, active,
        chat_research_extra_credits, chat_research_extra_cost, chat_research_write_max_tokens, chat_research_search_model)
        VALUES ($1, $1, 'openrouter-chat', 'test/model', 'text', 1, 0.0020, 'per_generation', false, 16, 0.29, 4096, 'cheap/search')`, [`${id}-floor`], '23514');
    // All three columns or none.
    await refused(`INSERT INTO public.model_catalog (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, active, chat_research_extra_credits)
        VALUES ($1, $1, 'openrouter-chat', 'test/model', 'text', 1, 0.0020, 'per_generation', false, 17)`, [`${id}-partial`], '23514');
    // The write cap is held to the same range as every reply cap.
    for (const cap of [100, 9000]) {
        await refused(`INSERT INTO public.model_catalog (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, active,
            chat_research_extra_credits, chat_research_extra_cost, chat_research_write_max_tokens, chat_research_search_model)
            VALUES ($1, $1, 'openrouter-chat', 'test/model', 'text', 1, 0.0020, 'per_generation', false, 17, 0.29, $2, 'cheap/search')`, [`${id}-cap${cap}`, cap], '23514');
    }
    // The search model is required, and must be a plain model slug.
    await refused(`INSERT INTO public.model_catalog (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, active,
        chat_research_extra_credits, chat_research_extra_cost, chat_research_write_max_tokens)
        VALUES ($1, $1, 'openrouter-chat', 'test/model', 'text', 1, 0.0020, 'per_generation', false, 17, 0.29, 4096)`, [`${id}-nosearch`], '23514');
    for (const bad of ['', 'has space', '../x', 'a'.repeat(200)]) {
        await refused(`INSERT INTO public.model_catalog (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, active,
            chat_research_extra_credits, chat_research_extra_cost, chat_research_write_max_tokens, chat_research_search_model)
            VALUES ($1, $1, 'openrouter-chat', 'test/model', 'text', 1, 0.0020, 'per_generation', false, 17, 0.29, 4096, $2)`, [`${id}-slug`, bad], '23514');
    }
    // Credits and cost must be positive.
    await refused(`INSERT INTO public.model_catalog (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, active,
        chat_research_extra_credits, chat_research_extra_cost, chat_research_write_max_tokens, chat_research_search_model)
        VALUES ($1, $1, 'openrouter-chat', 'test/model', 'text', 1, 0.0020, 'per_generation', false, 5, 0, 4096, 'cheap/search')`, [`${id}-zero`], '23514');
    // Research is a text option: a non-text row may not carry it.
    await refused(`INSERT INTO public.model_catalog (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, active,
        chat_research_extra_credits, chat_research_extra_cost, chat_research_write_max_tokens, chat_research_search_model)
        VALUES ($1, $1, 'fal', 'fal-ai/test', 'text-to-image', 1, 0.0200, 'per_generation', false, 17, 0.29, 4096, 'cheap/search')`, [`${id}-image`], '23514');
    await c.query('ROLLBACK');
    console.log('chat research columns: ok');
} finally {
    await c.end();
}
