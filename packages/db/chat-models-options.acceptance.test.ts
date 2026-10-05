/** Chat options: strict columns, the margin floor enforced per add-on, every row's recorded cost covers its worst case. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.DATABASE_URL;
const FLOOR = 0.01796;
// $ per million tokens (input, output), OpenRouter's public list read 2026-10-05.
const RATES: Record<string, [number, number]> = {
    'chat-llama-4-maverick': [0.19, 0.65], 'chat-ministral-14b': [0.2, 0.2], 'chat-mistral-small': [0.15, 0.6],
    'chat-claude-sonnet-5.5': [2, 10], 'chat-claude-opus-5.5': [4, 20], 'chat-gpt-6.1-sol': [2, 10],
    'chat-gemini-3.8-flash': [0.75, 3.75], 'chat-grok-4.7': [2, 6], 'chat-gpt-6-luna': [0.1, 0.5], 'chat-deepseek-v4.1-flash': [0.3, 1.2],
};
const LIVE = ['chat-llama-4-maverick', 'chat-ministral-14b', 'chat-mistral-small'];
const STAGED = Object.keys(RATES).filter((id) => !LIVE.includes(id));
const WEB_FEE = 0.02, WEB_EXTRA_INPUT = 16000, EXTRA_OUTPUT = 8192 - 4096;

const setup = async (db: pg.Client) => {
    const read = (n: string) => readFile(new URL(`./schema/supabase/${n}`, import.meta.url), 'utf8');
    await db.query(await read('0029_cost_unit_and_deactivate_seedance.sql'));
    await db.query(await read('0194_chat_models_staged.sql'));
    await db.query(await read('0196_chat_models_reasoning.sql'));
    return read('0197_chat_models_options.sql');
};

test('the add-on columns refuse an extra under the floor, a half-set option, and a non-text row',
    { skip: !url && 'DATABASE_URL not set' }, async () => {
        assert.doesNotMatch(url!, /supabase\.(co|com)/, 'use an isolated test database');
        const db = new pg.Client({ connectionString: url });
        await db.connect();
        try {
            await db.query('BEGIN');
            await db.query(await setup(db));
            const bad = async (set: string, re: RegExp) => {
                await db.query('SAVEPOINT s');
                await assert.rejects(db.query(`UPDATE public.model_catalog SET ${set} WHERE id = 'chat-claude-sonnet-5.5'`), re);
                await db.query('ROLLBACK TO SAVEPOINT s');
            };
            await bad('chat_web_extra_credits = 2', /chat_web_check/); // 0.0520 needs 3
            await bad('chat_web_extra_credits = NULL', /chat_web_check/); // cost without credits
            await bad('chat_web_extra_cost = 0.5', /chat_web_check/); // credits no longer cover it
            await bad('chat_thinking_extra_credits = 2', /chat_thinking_check/); // 0.0410 needs 3
            await bad('chat_thinking_effort = NULL', /chat_thinking_check/); // half-set
            await bad("chat_thinking_effort = 'extreme'", /chat_thinking_check/);
            await bad('chat_thinking_max_reply_tokens = 2048', /chat_thinking_check/); // below the base cap of 4,096
            await bad('chat_thinking_max_reply_tokens = 9000', /chat_thinking_check/);
            await db.query('SAVEPOINT s');
            await assert.rejects(db.query(`UPDATE public.model_catalog SET modality = 'image' WHERE id = 'chat-claude-sonnet-5.5'`), /text_only_check|chat_budget_text_only/);
            await db.query('ROLLBACK TO SAVEPOINT s');
        } finally {
            await db.query('ROLLBACK');
            await db.end();
        }
    });

test('every row prices web search; the premium rows price thinking; recorded costs cover the worst case; replay keeps later edits',
    { skip: !url && 'DATABASE_URL not set' }, async () => {
        assert.doesNotMatch(url!, /supabase\.(co|com)/, 'use an isolated test database');
        const db = new pg.Client({ connectionString: url });
        await db.connect();
        try {
            await db.query('BEGIN');
            const migration = await setup(db);
            const before = (await db.query('SELECT * FROM public.model_catalog WHERE id <> ALL($1) ORDER BY id', [Object.keys(RATES)])).rows;
            await db.query(migration);
            await db.query(migration); // replay: absolute values, same result
            const { rows } = await db.query('SELECT * FROM public.model_catalog WHERE id = ANY($1) ORDER BY id', [Object.keys(RATES)]);
            assert.equal(rows.length, 10);
            for (const r of rows) {
                const [inRate, outRate] = RATES[r.id];
                const webWorst = WEB_FEE + (WEB_EXTRA_INPUT * inRate) / 1e6;
                assert.ok(Number(r.chat_web_extra_cost) >= webWorst - 1e-9, `${r.id} web cost ${r.chat_web_extra_cost} < worst ${webWorst}`);
                assert.ok(r.chat_web_extra_credits >= Math.ceil(Number(r.chat_web_extra_cost) / FLOOR), `${r.id} web below floor`);
                if (LIVE.includes(r.id)) {
                    assert.equal(r.chat_thinking_effort, null, `${r.id} does not reason`);
                } else {
                    const thinkWorst = (EXTRA_OUTPUT * outRate) / 1e6;
                    assert.equal(r.chat_thinking_effort, 'high');
                    assert.equal(r.chat_thinking_max_reply_tokens, 8192);
                    assert.ok(Number(r.chat_thinking_extra_cost) >= thinkWorst - 1e-9, `${r.id} thinking cost ${r.chat_thinking_extra_cost} < worst ${thinkWorst}`);
                    assert.ok(r.chat_thinking_extra_credits >= Math.ceil(Number(r.chat_thinking_extra_cost) / FLOOR), `${r.id} thinking below floor`);
                    assert.equal(r.active, false, `${r.id} stays inactive`);
                }
            }
            assert.equal(STAGED.length, 7);
            assert.deepEqual((await db.query('SELECT * FROM public.model_catalog WHERE id <> ALL($1) ORDER BY id', [Object.keys(RATES)])).rows, before);
            // Repricing by hand survives a replay only if the migration does not overwrite it: it does (absolute
            // values), so a later change belongs in a new migration, which is the repository's rule for catalog edits.
            await db.query("UPDATE public.model_catalog SET active = true WHERE id = 'chat-grok-4.7'");
            await db.query(migration);
            assert.equal((await db.query("SELECT active FROM public.model_catalog WHERE id = 'chat-grok-4.7'")).rows[0].active, true);
        } finally {
            await db.query('ROLLBACK');
            await db.end();
        }
    });

test('the migration refuses to run if a priced row is missing', { skip: !url && 'DATABASE_URL not set' }, async () => {
    assert.doesNotMatch(url!, /supabase\.(co|com)/, 'use an isolated test database');
    const db = new pg.Client({ connectionString: url });
    await db.connect();
    try {
        await db.query('BEGIN');
        const migration = await setup(db);
        await db.query("DELETE FROM public.model_catalog WHERE id = 'chat-gpt-6-luna'");
        await assert.rejects(db.query(migration), /Expected seven staged premium chat rows to price options on, updated 6/);
    } finally {
        await db.query('ROLLBACK');
        await db.end();
    }
});
