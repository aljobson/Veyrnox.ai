/**
 * 0213 adds model_catalog.chat_web_engine: how a row's Web search runs. 'plugin' is OpenRouter's web plugin (what runs today);
 * 'capped' is our own search call with each result cut to a fixed length. It is additive, so the release before it keeps working,
 * and every existing row reads 'plugin'. A row cannot be 'capped' without a Web search price, and only a text row can offer it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.DATABASE_URL;

const setup = async (db: pg.Client) => {
    const read = (n: string) => readFile(new URL(`./schema/supabase/${n}`, import.meta.url), 'utf8');
    await db.query(await read('0029_cost_unit_and_deactivate_seedance.sql'));
    // Start from no chat rows, whatever earlier migrations on this database have already done (one rolled-back transaction).
    await db.query("DELETE FROM public.model_catalog WHERE id LIKE 'chat-%' AND provider = 'openrouter-chat'");
    for (const f of ['0193_chat.sql', '0194_chat_models_staged.sql', '0196_chat_models_reasoning.sql', '0197_chat_models_options.sql', '0198_chat_models_images.sql']) {
        await db.query(await read(f));
    }
    return read('0213_chat_web_engine.sql');
};
const refused = async (db: pg.Client, sql: string, args: unknown[], pattern: RegExp, label: string) => {
    await db.query('SAVEPOINT s');
    await assert.rejects(db.query(sql, args), pattern, label);
    await db.query('ROLLBACK TO SAVEPOINT s');
};

test('every existing row reads plugin, replay is safe, and no other column changes', { skip: !url && 'DATABASE_URL not set' }, async () => {
    assert.doesNotMatch(url!, /supabase\.(co|com)/, 'use an isolated test database');
    const db = new pg.Client({ connectionString: url });
    await db.connect();
    try {
        await db.query('BEGIN');
        const migration = await setup(db);
        const before = (await db.query('SELECT * FROM public.model_catalog ORDER BY id')).rows;
        await db.query(migration);
        await db.query(migration);
        const after = (await db.query('SELECT * FROM public.model_catalog ORDER BY id')).rows;
        assert.equal(after.length, before.length);
        assert.ok(after.every((r) => r.chat_web_engine === 'plugin'), 'every row, text or not, defaults to plugin');
        const strip = (rows: any[]) => rows.map(({ chat_web_engine, ...rest }) => rest);
        assert.deepEqual(strip(after), strip(before), 'nothing else changed');
        assert.ok((await db.query("SELECT 1 FROM public.model_catalog WHERE id LIKE 'chat-%'")).rowCount! >= 10, 'the chat rows were present');
    } finally {
        await db.query('ROLLBACK');
        await db.end();
    }
});

test('the engine is plugin or capped; capped needs a Web search price; only a text row may be capped', { skip: !url && 'DATABASE_URL not set' }, async () => {
    assert.doesNotMatch(url!, /supabase\.(co|com)/, 'use an isolated test database');
    const db = new pg.Client({ connectionString: url });
    await db.connect();
    try {
        await db.query('BEGIN');
        await db.query(await setup(db));
        const priced = 'chat-gpt-6-luna'; // has a Web search price from 0197
        await db.query("UPDATE public.model_catalog SET chat_web_engine = 'capped' WHERE id = $1", [priced]);
        assert.equal((await db.query('SELECT chat_web_engine AS e FROM public.model_catalog WHERE id = $1', [priced])).rows[0].e, 'capped');
        await db.query("UPDATE public.model_catalog SET chat_web_engine = 'plugin' WHERE id = $1", [priced]);

        await refused(db, "UPDATE public.model_catalog SET chat_web_engine = 'exa' WHERE id = $1", [priced], /model_catalog_chat_web_engine_check/, 'an unknown engine');
        await refused(db, "UPDATE public.model_catalog SET chat_web_engine = '' WHERE id = $1", [priced], /model_catalog_chat_web_engine_check/, 'an empty engine');
        await refused(db, 'UPDATE public.model_catalog SET chat_web_engine = NULL WHERE id = $1', [priced], /null value|not-null/, 'a null engine');
        // Capped without a price: drop the price and the check that pairs the two columns still holds first, so test the engine check directly.
        await db.query('SAVEPOINT s');
        await db.query('UPDATE public.model_catalog SET chat_web_extra_credits = NULL, chat_web_extra_cost = NULL WHERE id = $1', [priced]);
        await assert.rejects(db.query("UPDATE public.model_catalog SET chat_web_engine = 'capped' WHERE id = $1", [priced]), /model_catalog_chat_web_engine_check/, 'capped with no price');
        await db.query('ROLLBACK TO SAVEPOINT s');
        // A row that is not text cannot be capped.
        const nonText = (await db.query("SELECT id FROM public.model_catalog WHERE modality <> 'text' LIMIT 1")).rows[0];
        if (nonText) await refused(db, "UPDATE public.model_catalog SET chat_web_engine = 'capped' WHERE id = $1", [nonText.id], /model_catalog_chat_web_engine_check/, 'a non-text row');
    } finally {
        await db.query('ROLLBACK');
        await db.end();
    }
});
