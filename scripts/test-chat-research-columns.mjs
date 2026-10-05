#!/usr/bin/env node
// 0208 (ADR-0070): the Deep research columns and their rules. Runs against the full migration replay (ledger-tests.yml).
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
    const migration = await readFile(new URL('../packages/db/schema/supabase/0208_chat_research_columns.sql', import.meta.url), 'utf8');
    await c.query('BEGIN'); await c.query(migration); await c.query(migration); await c.query('ROLLBACK'); // safe to apply twice

    await c.query('BEGIN');
    const id = `research-test-${randomUUID().slice(0, 8)}`;
    const insert = (modality, credits, cost, cap) => c.query(
        `INSERT INTO public.model_catalog (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, active,
            chat_research_extra_credits, chat_research_extra_cost, chat_research_write_max_tokens)
         VALUES ($1, $1, 'openrouter-chat', 'test/model', $2, 1, 0.0020, 'per_generation', false, $3, $4, $5)`, [id + modality + String(credits), modality, credits, cost, cap]);

    // No row offers research until a later migration sets it, and a plain row needs none of the columns.
    const none = await one(`SELECT count(*)::int AS n FROM public.model_catalog WHERE chat_research_extra_credits IS NOT NULL OR chat_research_extra_cost IS NOT NULL OR chat_research_write_max_tokens IS NOT NULL`);
    assert.equal(none.n, 0, 'nothing offers research yet');
    await insert('text', null, null, null);

    // A valid trio: $0.29 at the floor is ceil(0.29 / 0.01796) = 17 Credits.
    await insert('text', 17, 0.29, 4096);
    // The floor is enforced: 16 Credits is under it.
    await refused(`INSERT INTO public.model_catalog (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, active,
        chat_research_extra_credits, chat_research_extra_cost, chat_research_write_max_tokens)
        VALUES ($1, $1, 'openrouter-chat', 'test/model', 'text', 1, 0.0020, 'per_generation', false, 16, 0.29, 4096)`, [`${id}-floor`], '23514');
    // All three columns or none.
    await refused(`INSERT INTO public.model_catalog (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, active, chat_research_extra_credits)
        VALUES ($1, $1, 'openrouter-chat', 'test/model', 'text', 1, 0.0020, 'per_generation', false, 17)`, [`${id}-partial`], '23514');
    // The write cap is held to the same range as every reply cap.
    for (const cap of [100, 9000]) {
        await refused(`INSERT INTO public.model_catalog (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, active,
            chat_research_extra_credits, chat_research_extra_cost, chat_research_write_max_tokens)
            VALUES ($1, $1, 'openrouter-chat', 'test/model', 'text', 1, 0.0020, 'per_generation', false, 17, 0.29, $2)`, [`${id}-cap${cap}`, cap], '23514');
    }
    // Credits and cost must be positive.
    await refused(`INSERT INTO public.model_catalog (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, active,
        chat_research_extra_credits, chat_research_extra_cost, chat_research_write_max_tokens)
        VALUES ($1, $1, 'openrouter-chat', 'test/model', 'text', 1, 0.0020, 'per_generation', false, 5, 0, 4096)`, [`${id}-zero`], '23514');
    // Research is a text option: a non-text row may not carry it.
    await refused(`INSERT INTO public.model_catalog (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, cost_unit, active,
        chat_research_extra_credits, chat_research_extra_cost, chat_research_write_max_tokens)
        VALUES ($1, $1, 'fal', 'fal-ai/test', 'text-to-image', 1, 0.0200, 'per_generation', false, 17, 0.29, 4096)`, [`${id}-image`], '23514');
    await c.query('ROLLBACK');
    console.log('chat research columns: ok');
} finally {
    await c.end();
}
