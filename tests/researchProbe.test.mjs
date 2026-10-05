import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQueries, runOne, worstCase, runProbe, fetchRates, isMain, LIMITS } from '../scripts/measure-chat-research.mjs';
import { mkdtempSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** A fake OpenRouter: the plan lists `planLines`, every call reports `usage`. */
function fakeFetch({ planLines = ['a', 'b', 'c'], cost = { plan: 0.001, search: 0.03, write: 0.2 }, fail = null } = {}) {
    const calls = [];
    const fetchImpl = async (url, init) => {
        const body = JSON.parse(init.body); calls.push(body);
        if (fail && calls.length === fail) return new Response('secret vendor text with the prompt', { status: 500 });
        const kind = body.plugins ? 'search' : body.reasoning ? 'write' : 'plan';
        const text = kind === 'plan' ? planLines.join('\n') : `${kind} text`;
        return Response.json({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 100, completion_tokens: 50, cost: cost[kind] } });
    };
    return { fetchImpl, calls };
}

test('parseQueries strips numbering and bullets, drops blanks, and caps at four', () => {
    assert.deepEqual(parseQueries('1. one\n- two\n\n* three\n4) four\nfive'), ['one', 'two', 'three', 'four']);
    assert.deepEqual(parseQueries(''), []);
    assert.deepEqual(parseQueries(undefined), []);
});

test('a run is exactly plan, one search per query, then one write, in that order', async () => {
    const { fetchImpl, calls } = fakeFetch({ planLines: ['q1', 'q2'] });
    const run = await runOne({ fetchImpl, apiKey: 'k', model: 'm/x', question: 'why?' });
    assert.deepEqual(run.steps.map((s) => s.step), ['plan', 'search', 'search', 'write']);
    assert.equal(calls.length, 4);
    assert.equal(calls[1].plugins[0].max_results, LIMITS.results);
    assert.equal(calls[3].max_tokens, LIMITS.writeTokens);
    assert.equal(calls[3].reasoning.effort, LIMITS.writeEffort);
    assert.ok(calls.every((c) => c.provider.data_collection === 'deny' && c.usage.include === true && c.stream === false));
    assert.ok(Math.abs(run.cost - (0.001 + 2 * 0.03 + 0.2)) < 1e-9);
});

test('a plan of more than four queries still searches at most four times', async () => {
    const { fetchImpl } = fakeFetch({ planLines: ['a', 'b', 'c', 'd', 'e', 'f'] });
    const run = await runOne({ fetchImpl, apiKey: 'k', model: 'm/x', question: 'q' });
    assert.equal(run.searches, LIMITS.searches);
});

test('worstCase takes the dearest of each step and prices four searches', () => {
    const runs = [
        { steps: [{ step: 'plan', cost: 0.001 }, { step: 'search', cost: 0.02 }, { step: 'write', cost: 0.1 }] },
        { steps: [{ step: 'plan', cost: 0.002 }, { step: 'search', cost: 0.05 }, { step: 'write', cost: 0.3 }] },
    ];
    const w = worstCase(runs);
    assert.deepEqual([w.plan, w.search, w.write], [0.002, 0.05, 0.3]);
    assert.ok(Math.abs(w.total - (0.002 + 4 * 0.05 + 0.3)) < 1e-9);
});

test('a provider failure is a status code only, never the vendor text', async () => {
    const { fetchImpl } = fakeFetch({ fail: 2 });
    await assert.rejects(runOne({ fetchImpl, apiKey: 'k', model: 'm/x', question: 'q' }), (e) => {
        assert.equal(e.message, 'OpenRouter answered 500');
        assert.ok(!/secret/.test(e.message));
        return true;
    });
});

test('the budget stops the probe once measured spend passes it', async () => {
    const { fetchImpl } = fakeFetch({ cost: { plan: 0.5, search: 0.5, write: 0.5 } });
    const lines = [];
    const out = await runProbe({ fetchImpl, apiKey: 'k', models: ['m/a', 'm/b'], questions: ['q1', 'q2'], budget: 1, log: (l) => lines.push(l) });
    assert.equal(out.stopped, true);
    assert.equal(out.byModel['m/a'].length, 1, 'stopped after the first run overshot the budget');
    assert.ok(out.byModel['m/b'] === undefined || out.byModel['m/b'].length === 0);
});

test('a missing cost is reported as unknown, not as zero', async () => {
    const fetchImpl = async () => Response.json({ choices: [{ message: { content: 'x' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    const run = await runOne({ fetchImpl, apiKey: 'k', model: 'm/x', question: 'q' });
    assert.equal(run.cost, null);
});

test('search steps run at low reasoning effort so a reasoning model cannot spend the cap thinking', async () => {
    const { fetchImpl, calls } = fakeFetch({ planLines: ['q1'] });
    await runOne({ fetchImpl, apiKey: 'k', model: 'm/x', question: 'q' });
    assert.equal(calls[1].reasoning.effort, LIMITS.searchEffort);
    assert.equal(calls[1].max_tokens, LIMITS.searchTokens);
});

test('a run whose searches all came back empty is refused, not reported as cheap', async () => {
    const fetchImpl = async (url, init) => {
        const body = JSON.parse(init.body);
        const text = body.plugins ? '' : body.reasoning ? 'write' : 'q1\nq2';
        return Response.json({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 1, completion_tokens: 700, cost: 0.04 } });
    };
    await assert.rejects(runOne({ fetchImpl, apiKey: 'k', model: 'm/x', question: 'q' }), /not a valid measurement/);
});

test('worstCase bounds the write from rates when one sample did not reach the reply cap', () => {
    const runs = [{ steps: [{ step: 'plan', cost: 0.001 }, { step: 'search', cost: 0.05 },
        { step: 'write', cost: 0.01, promptTokens: 4000 }] }];
    const rate = { prompt: 0.000002, completion: 0.00001 };
    const w = worstCase(runs, rate);
    const atCap = 4000 * rate.prompt + LIMITS.writeTokens * rate.completion;
    assert.equal(w.writeBasis, 'rates');
    assert.ok(Math.abs(w.write - atCap) < 1e-9);
    assert.ok(Math.abs(w.total - (0.001 + 4 * 0.05 + atCap)) < 1e-9);
    assert.equal(worstCase(runs).writeBasis, 'measured', 'without rates it reports what was measured');
});

test('a measured write dearer than the bound wins', () => {
    const runs = [{ steps: [{ step: 'plan', cost: 0 }, { step: 'search', cost: 0 }, { step: 'write', cost: 9, promptTokens: 10 }] }];
    assert.equal(worstCase(runs, { prompt: 1e-6, completion: 1e-6 }).write, 9);
});

test('fetchRates reads per-token prices for the models asked about, and an outage is an empty answer', async () => {
    const ok = async () => Response.json({ data: [{ id: 'a/x', pricing: { prompt: '0.000002', completion: '0.00001' } }, { id: 'b/y', pricing: { prompt: '1', completion: '1' } }] });
    assert.deepEqual(await fetchRates(['a/x'], ok), { 'a/x': { prompt: 0.000002, completion: 0.00001 } });
    assert.deepEqual(await fetchRates(['a/x'], async () => new Response('no', { status: 503 })), {});
    assert.deepEqual(await fetchRates(['a/x'], async () => { throw new Error('down'); }), {});
});

test('searches run together, and the run reports wall-clock rather than the sum of the steps', async () => {
    let inFlight = 0, peak = 0;
    const fetchImpl = async (url, init) => {
        const body = JSON.parse(init.body);
        const kind = body.plugins ? 'search' : body.reasoning ? 'write' : 'plan';
        if (kind === 'search') { inFlight += 1; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 40)); inFlight -= 1; }
        return Response.json({ choices: [{ message: { content: kind === 'plan' ? 'a\nb\nc\nd' : `${kind} text` } }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.01 } });
    };
    const run = await runOne({ fetchImpl, apiKey: 'k', model: 'm/x', question: 'q' });
    assert.equal(peak, 4, 'all four searches were in flight together');
    assert.deepEqual(run.steps.map((s) => s.step), ['plan', 'search', 'search', 'search', 'search', 'write'], 'steps stay in order');
    assert.ok(run.ms < run.steps.reduce((a, s) => a + s.ms, 0), 'wall-clock is less than the sum of the step times');
});

test('empty searches are counted and the search effort is off', async () => {
    assert.equal(LIMITS.searchEffort, 'none');
    let n = 0;
    const fetchImpl = async (url, init) => {
        const body = JSON.parse(init.body);
        const kind = body.plugins ? 'search' : body.reasoning ? 'write' : 'plan';
        if (kind === 'search') n += 1;
        const text = kind === 'plan' ? 'a\nb' : kind === 'search' && n === 1 ? '' : `${kind} text`;
        return Response.json({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.01 } });
    };
    const run = await runOne({ fetchImpl, apiKey: 'k', model: 'm/x', question: 'q' });
    assert.equal(run.emptySearches, 1);
});

test('isMain sees through a symlinked path, so a script run from a link still runs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'probe-'));
    const real = join(dir, 'real.mjs'); writeFileSync(real, '');
    const link = join(dir, 'link.mjs'); symlinkSync(real, link);
    assert.equal(isMain(link, pathToFileURL(realpathSync(real)).href), true, 'launched through a link');
    assert.equal(isMain(real, pathToFileURL(real).href), true);
    assert.equal(isMain(join(dir, 'other.mjs'), pathToFileURL(real).href), false, 'a different file is not main');
    assert.equal(isMain(undefined, pathToFileURL(real).href), false);
});
