/** Chat Images option: strict columns, the margin floor per extra, and every recorded cost covers four measured images. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.DATABASE_URL;
const FLOOR = 0.01796;
const IMAGES = 4;
// [input $/M, measured input tokens for one image at 2,048 px], read live 2026-10-05.
const MEASURED: Record<string, [number, number]> = {
    'chat-claude-sonnet-5.5': [2, 4781], 'chat-claude-opus-5.5': [4, 4781], 'chat-gpt-6.1-sol': [2, 4929], 'chat-gpt-6-luna': [0.1, 4929],
    'chat-grok-4.7': [2, 3689], 'chat-gemini-3.8-flash': [0.75, 1096], 'chat-deepseek-v4.1-flash': [0.3, 1031],
    'chat-llama-4-maverick': [0.19, 2484], 'chat-mistral-small': [0.15, 3103], 'chat-ministral-14b': [0.2, 3091],
};
const IDS = Object.keys(MEASURED);

const setup = async (db: pg.Client) => {
    const read = (n: string) => readFile(new URL(`./schema/supabase/${n}`, import.meta.url), 'utf8');
    await db.query(await read('0029_cost_unit_and_deactivate_seedance.sql'));
    // Start from no chat rows, whatever earlier migrations on this database have already done (all in one rolled-back transaction).
    await db.query("DELETE FROM public.model_catalog WHERE id LIKE 'chat-%' AND provider = 'openrouter-chat'");
    for (const f of ['0194_chat_models_staged.sql', '0196_chat_models_reasoning.sql', '0197_chat_models_options.sql']) await db.query(await read(f));
    return read('0198_chat_models_images.sql');
};

test('every row prices Images; the recorded cost covers four measured images; the price clears the floor; replay is stable',
    { skip: !url && 'DATABASE_URL not set' }, async () => {
        assert.doesNotMatch(url!, /supabase\.(co|com)/, 'use an isolated test database');
        const db = new pg.Client({ connectionString: url });
        await db.connect();
        try {
            await db.query('BEGIN');
            const migration = await setup(db);
            const before = (await db.query('SELECT * FROM public.model_catalog WHERE id <> ALL($1) ORDER BY id', [IDS])).rows;
            await db.query(migration);
            await db.query(migration);
            const { rows } = await db.query('SELECT * FROM public.model_catalog WHERE id = ANY($1) ORDER BY id', [IDS]);
            assert.equal(rows.length, 10);
            for (const r of rows) {
                const [rate, tokens] = MEASURED[r.id];
                const worst = (IMAGES * tokens * rate) / 1e6;
                assert.ok(Number(r.chat_images_extra_cost) >= worst - 1e-9, `${r.id} records ${r.chat_images_extra_cost}, four measured images cost ${worst}`);
                assert.ok(r.chat_images_extra_credits >= Math.ceil(Number(r.chat_images_extra_cost) / FLOOR), `${r.id} below the floor`);
            }
            assert.deepEqual((await db.query('SELECT * FROM public.model_catalog WHERE id <> ALL($1) ORDER BY id', [IDS])).rows, before);
        } finally {
            await db.query('ROLLBACK');
            await db.end();
        }
    });

test('the images columns refuse an extra under the floor, a half-set option, and a non-text row',
    { skip: !url && 'DATABASE_URL not set' }, async () => {
        assert.doesNotMatch(url!, /supabase\.(co|com)/, 'use an isolated test database');
        const db = new pg.Client({ connectionString: url });
        await db.connect();
        try {
            await db.query('BEGIN');
            await db.query(await setup(db));
            const bad = async (set: string, re: RegExp) => {
                await db.query('SAVEPOINT s');
                await assert.rejects(db.query(`UPDATE public.model_catalog SET ${set} WHERE id = 'chat-claude-opus-5.5'`), re);
                await db.query('ROLLBACK TO SAVEPOINT s');
            };
            await bad('chat_images_extra_credits = 5', /chat_images_check/); // 0.0928 needs 6
            await bad('chat_images_extra_credits = NULL', /chat_images_check/);
            await bad('chat_images_extra_cost = 0', /chat_images_check/);
            await db.query('SAVEPOINT s');
            await assert.rejects(db.query(`UPDATE public.model_catalog SET modality = 'image' WHERE id = 'chat-claude-opus-5.5'`), /text_only_check/);
            await db.query('ROLLBACK TO SAVEPOINT s');
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
        await db.query("DELETE FROM public.model_catalog WHERE id = 'chat-ministral-14b'");
        await assert.rejects(db.query(migration), /Expected ten chat rows to price Images on, updated 9/);
    } finally {
        await db.query('ROLLBACK');
        await db.end();
    }
});
