import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    projectRef,
    pendingMigrations,
    applyPending,
    managementClient,
} from '../scripts/apply-migrations.mjs';

const sql = (name, text = `-- ${name}\nselect 1;\n`) => ({ name, text });

test('projectRef reads the ref from the public Supabase URL and refuses anything else', () => {
    assert.equal(projectRef('https://xdxdzmsztyzbnzeforxx.supabase.co'), 'xdxdzmsztyzbnzeforxx');
    for (const bad of ['https://evil.example.com', 'http://xdxdzmsztyzbnzeforxx.supabase.co', 'https://short.supabase.co', '', undefined]) {
        assert.throws(() => projectRef(bad), /Supabase URL/, String(bad));
    }
});

test('nothing pending when every file is applied under its own name', () => {
    const files = [sql('0053_job_submit_rejected.sql'), sql('0054_credit_top_up.sql')];
    assert.deepEqual(pendingMigrations(['0053_job_submit_rejected', '0054_credit_top_up'], files), []);
});

test('a new top-numbered file is pending', () => {
    const files = [sql('0054_credit_top_up.sql'), sql('0068_backfill_order_binding.sql')];
    assert.deepEqual(pendingMigrations(['0054_credit_top_up'], files).map((f) => f.name), ['0068_backfill_order_binding.sql']);
});

test('pending files come back in number order', () => {
    const files = [sql('0070_c.sql'), sql('0054_credit_top_up.sql'), sql('0069_b.sql')];
    assert.deepEqual(pendingMigrations(['0054_credit_top_up'], files).map((f) => f.name), ['0069_b.sql', '0070_c.sql']);
});

test('a file renumbered after it was applied is not pending (numbers ignored)', () => {
    const files = [sql('0066_freeze_since_purchase.sql'), sql('0067_veo_4s_clip_costs.sql')];
    assert.deepEqual(pendingMigrations(['0066_freeze_since_purchase', '0066_veo_4s_clip_costs'], files), []);
});

test('an explicit "Applied name:" header marks a file applied', () => {
    const files = [sql('0054_x.sql'), sql('0060_fold.sql', '-- Applied name: 0059_something_else.\nselect 1;\n')];
    assert.deepEqual(pendingMigrations(['0054_x', '0059_something_else'], files), []);
});

test('a file that only mentions an applied migration in prose is still pending', () => {
    const text = '-- Applied name: 0068_backfill_order_binding.\n-- Builds on 0054_credit_top_up and 0066_freeze_since_purchase.\nselect 1;\n';
    const files = [sql('0054_credit_top_up.sql'), sql('0066_freeze_since_purchase.sql'), sql('0068_backfill_order_binding.sql', text)];
    assert.deepEqual(
        pendingMigrations(['0054_credit_top_up', '0066_freeze_since_purchase'], files).map((f) => f.name),
        ['0068_backfill_order_binding.sql'],
    );
});

test('a batched replay name covers every file in its range', () => {
    const files = [sql('0006_ledger_rpc_functions.sql'), sql('0007_job_state_transitions.sql'), sql('0009_x.sql')];
    assert.deepEqual(pendingMigrations(['0006_0009_ledger_rpcs_job_transitions_rate_limit_stored'], files), []);
});

test('refuses to plan a file numbered below an applied one instead of applying it out of order', () => {
    const files = [sql('0053_forgotten.sql'), sql('0054_credit_top_up.sql')];
    assert.throws(() => pendingMigrations(['0054_credit_top_up'], files), /out of order.*0053_forgotten/s);
});

test('ignores files without a four-digit number', () => {
    assert.deepEqual(pendingMigrations(['0054_a'], [sql('0054_a.sql'), sql('README.sql'), sql('draft.sql')]), []);
});

function fakeDeps({ appliedSeq, applyResults = [] }) {
    const calls = { list: 0, apply: [] };
    let listIdx = 0;
    return {
        calls,
        listApplied: async () => {
            calls.list++;
            const names = appliedSeq[Math.min(listIdx, appliedSeq.length - 1)];
            listIdx++;
            return names;
        },
        apply: async (req) => {
            calls.apply.push(req);
            return applyResults[calls.apply.length - 1] ?? { ok: true };
        },
        log: () => {},
    };
}

test('applies each pending file byte for byte, with its name and a content-bound idempotency key', async () => {
    const text = '-- Applied name: 0068_b.\ncreate table if not exists public.b(id int);\n';
    const files = [sql('0054_a.sql'), sql('0068_b.sql', text)];
    const deps = fakeDeps({ appliedSeq: [['0054_a']] });
    const out = await applyPending(files, deps);
    assert.deepEqual(out, { applied: ['0068_b'], skipped: [], failed: null });
    assert.equal(deps.calls.apply.length, 1);
    const req = deps.calls.apply[0];
    assert.equal(req.name, '0068_b');
    assert.equal(req.query, text, 'exact file bytes, comments and trailing newline included');
    assert.equal(req.idempotencyKey, `0068_b-${createHash('sha256').update(text).digest('hex').slice(0, 32)}`);
});

test('re-reads the ledger before each apply and skips a file another session applied meanwhile', async () => {
    const files = [sql('0054_a.sql'), sql('0068_b.sql'), sql('0069_c.sql')];
    // Planned with both pending; by the time 0069 is reached someone applied it.
    const deps = fakeDeps({ appliedSeq: [['0054_a'], ['0054_a'], ['0054_a', '0068_b', '0069_c']] });
    const out = await applyPending(files, deps);
    assert.deepEqual(out, { applied: ['0068_b'], skipped: ['0069_c'], failed: null });
    assert.deepEqual(deps.calls.apply.map((r) => r.name), ['0068_b']);
});

test('stops at the first failure and applies nothing after it', async () => {
    const files = [sql('0054_a.sql'), sql('0068_b.sql'), sql('0069_c.sql')];
    const deps = fakeDeps({ appliedSeq: [['0054_a']], applyResults: [{ ok: false, error: 'supabase 500' }] });
    const out = await applyPending(files, deps);
    assert.deepEqual(out, { applied: [], skipped: [], failed: { name: '0068_b', error: 'supabase 500' } });
    assert.equal(deps.calls.apply.length, 1);
});

test('an out-of-order ledger stops the run before any apply', async () => {
    const files = [sql('0053_forgotten.sql'), sql('0054_a.sql')];
    const deps = fakeDeps({ appliedSeq: [['0054_a']] });
    await assert.rejects(applyPending(files, deps), /out of order/);
    assert.equal(deps.calls.apply.length, 0);
});

test('managementClient calls the constant API host with bearer auth and the idempotency header', async () => {
    const seen = [];
    const fetch = async (url, init = {}) => {
        seen.push({ url: String(url), init });
        if ((init.method ?? 'GET') === 'GET') {
            return new Response(JSON.stringify([{ version: '20260913114058', name: '0068_backfill_order_binding' }, { version: '1' }]), { status: 200 });
        }
        return new Response('{}', { status: 200 });
    };
    const c = managementClient({ token: 'sbp_test', ref: 'xdxdzmsztyzbnzeforxx', fetch });
    assert.deepEqual(await c.listApplied(), ['0068_backfill_order_binding']);
    assert.deepEqual(await c.apply({ name: '0069_c', query: 'select 1;', idempotencyKey: 'k1' }), { ok: true });
    assert.equal(seen[0].url, 'https://api.supabase.com/v1/projects/xdxdzmsztyzbnzeforxx/database/migrations');
    assert.equal(seen[0].init.headers.Authorization, 'Bearer sbp_test');
    assert.equal(seen[1].init.method, 'POST');
    assert.equal(seen[1].init.headers['Idempotency-Key'], 'k1');
    assert.deepEqual(JSON.parse(seen[1].init.body), { name: '0069_c', query: 'select 1;' });
});

test('managementClient reports a failed apply without leaking the response body', async () => {
    const fetch = async () => new Response('{"message":"syntax error at or near secret_thing"}', { status: 400 });
    const c = managementClient({ token: 't', ref: 'xdxdzmsztyzbnzeforxx', fetch });
    assert.deepEqual(await c.apply({ name: 'n', query: 'q', idempotencyKey: 'k' }), { ok: false, error: 'supabase 400' });
    await assert.rejects(c.listApplied(), /supabase 400/);
    assert.throws(() => managementClient({ token: '', ref: 'xdxdzmsztyzbnzeforxx', fetch }), /SUPABASE_ACCESS_TOKEN/);
});
