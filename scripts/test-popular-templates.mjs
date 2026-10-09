#!/usr/bin/env node
// 0215 (ADR-0072): the Popular templates ranking. Runs against the full migration replay (ledger-tests.yml).
// Fixtures are committed so the ranking can be read with real connections; the replay database is throwaway.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const c = new pg.Client({ connectionString: url });
await c.connect();
const one = async (sql, args = []) => (await c.query(sql, args)).rows[0];
const rank = async (days = 30, min = 2) => (await one('SELECT public.popular_templates($1, $2) AS r', [days, min])).r;

// Unique template ids per run so this never collides with real data or a second run on the same database.
const RUN = randomUUID().slice(0, 6);
const T = (name) => `t${RUN}-${name}`;

async function account() {
    const auth = randomUUID();
    await c.query('INSERT INTO auth.users(id, email, email_confirmed_at) VALUES ($1, $2, now())', [auth, `${auth}@example.invalid`]);
    return (await one('SELECT id FROM public.users WHERE auth_id = $1', [auth])).id;
}
// A job with the template id recorded, in the given state, for an account.
async function job(user, preset, state = 'STORED', ageDays = 0) {
    const d = (await one(`SELECT public.ledger_debit($1, $2, 1, 'debit:generation', 'seedance-2.0-fast', $3::jsonb) AS r`,
        [user, randomUUID(), JSON.stringify({ prompt: 'x', ...(preset ? { preset_id: preset } : {}) })])).r;
    assert.equal(d.ok, true, JSON.stringify(d));
    await c.query(`UPDATE public.jobs SET state = $2::job_state, created_at = now() - make_interval(days => $3) WHERE id = $1`, [d.job_id, state, ageDays]);
    return d.job_id;
}
const mine = (list) => list.filter((id) => id.startsWith(`t${RUN}-`));

try {
    const migration = await readFile(new URL('../packages/db/schema/supabase/0215_popular_templates.sql', import.meta.url), 'utf8');
    await c.query(migration); await c.query(migration); // safe to apply twice

    const users = await Promise.all(Array.from({ length: 4 }, () => account()));

    // Ranks by DISTINCT accounts: one account repeating a template does not count more than once.
    for (let i = 0; i < 5; i += 1) await job(users[0], T('repeat'));
    await job(users[1], T('repeat'));
    await job(users[0], T('wide')); await job(users[1], T('wide')); await job(users[2], T('wide'));
    assert.deepEqual(mine(await rank(30, 2)), [T('wide'), T('repeat')], 'wide has 3 accounts, repeat has 2 despite 6 jobs');

    // A template needs the minimum number of accounts before it ranks at all.
    assert.deepEqual(mine(await rank(30, 3)), [T('wide')]);
    assert.deepEqual(mine(await rank(30, 4)), []);

    // Only STORED jobs count; a failed or refunded one ranks nothing.
    await job(users[0], T('failed'), 'FAILED'); await job(users[1], T('failed'), 'REFUNDED'); await job(users[2], T('failed'), 'FAILED');
    assert.ok(!mine(await rank(30, 1)).includes(T('failed')), 'unfinished jobs never rank');

    // The window: an old job falls out.
    await job(users[0], T('old'), 'STORED', 40); await job(users[1], T('old'), 'STORED', 40);
    assert.ok(!mine(await rank(30, 1)).includes(T('old')));
    assert.ok(mine(await rank(60, 1)).includes(T('old')));

    // A job with no template, or a malformed id, is never in the list.
    await job(users[0], null); await job(users[0], 'Bad Id!'); await job(users[1], 'Bad Id!');
    assert.ok(!(await rank(30, 1)).some((id) => !/^[a-z0-9-]{1,40}$/.test(id)), 'only well-formed ids come out');

    // Order is by accounts, then by id, and the output carries ids only.
    const list = await rank(30, 1);
    assert.ok(list.every((x) => typeof x === 'string'), 'ids only: no counts, users or prompts');

    // Out-of-range arguments are clamped, not an error.
    assert.ok(Array.isArray(await rank(0, 0)) && Array.isArray(await rank(9999, -5)) && Array.isArray((await one('SELECT public.popular_templates(NULL, NULL) AS r')).r));

    // Service role only.
    const priv = await one(`SELECT has_function_privilege('anon', 'public.popular_templates(integer,integer)', 'EXECUTE') AS anon,
        has_function_privilege('authenticated', 'public.popular_templates(integer,integer)', 'EXECUTE') AS auth,
        has_function_privilege('service_role', 'public.popular_templates(integer,integer)', 'EXECUTE') AS svc`);
    assert.deepEqual(priv, { anon: false, auth: false, svc: true });
    console.log('popular templates: ok');
} finally {
    await c.end();
}
