import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQueries, runOne, worstCase, runProbe, LIMITS } from '../scripts/measure-chat-research.mjs';

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
