// The model picker's data: cost tiers, grouping by maker, and the cost filter. Pure, so tested without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TIERS, defaultModel, makerGroups, tierOf, tierLabel } from '../app/veyrnox/_lib/chatModels.js';

const M = (id, maker, label, credits) => ({ id, name: id, maker, maker_label: label, credits_per_reply: credits });
const models = [
    M('opus', 'claude', 'Claude', 7), M('sonnet', 'claude', 'Claude', 4), M('luna', 'chatgpt', 'ChatGPT', 1), M('sol', 'chatgpt', 'ChatGPT', 4),
    M('flash', 'gemini', 'Gemini', 2), M('ds', 'deepseek', 'DeepSeek', 1), M('grok', 'grok', 'Grok', 3), M('odd', 'other', 'Other', 1), M('llama', 'llama', 'Llama', 1),
];
const ids = (xs) => xs.map((m) => m.id);

test('cost tiers: 1 Credit is Low, 2 to 3 Medium, 4 and over High', () => {
    assert.deepEqual([1, 2, 3, 4, 7, 20].map(tierOf), ['low', 'medium', 'medium', 'high', 'high', 'high']);
    assert.deepEqual(TIERS.map((t) => [t.id, t.dots]), [['low', 1], ['medium', 2], ['high', 3]]);
    assert.equal(tierLabel('medium'), 'Medium');
    assert.equal(tierOf(undefined), 'low', 'a missing price reads as the lowest tier, not a crash');
});

test('makers come in a fixed order with the unknown ones last, and models inside keep their order', () => {
    const g = makerGroups(models, new Set());
    assert.deepEqual(g.map((x) => x.maker), ['claude', 'chatgpt', 'gemini', 'grok', 'deepseek', 'llama', 'other']);
    assert.deepEqual(ids(g[0].models), ['sonnet', 'opus'], 'cheapest first inside a maker');
    assert.equal(g[0].label, 'Claude');
});

test('the cost filter keeps only the chosen tiers, and an empty filter keeps all', () => {
    assert.deepEqual(makerGroups(models, new Set(['low'])).flatMap((g) => ids(g.models)).sort(), ['ds', 'llama', 'luna', 'odd']);
    assert.deepEqual(makerGroups(models, new Set(['high'])).flatMap((g) => ids(g.models)).sort(), ['opus', 'sol', 'sonnet']);
    assert.deepEqual(makerGroups(models, new Set(['low', 'medium'])).flatMap((g) => ids(g.models)).sort(), ['ds', 'flash', 'grok', 'llama', 'luna', 'odd']);
    assert.equal(makerGroups(models, new Set()).flatMap((g) => g.models).length, models.length);
});

test('the chosen model always stays in the list, even when the filter would hide it', () => {
    const g = makerGroups(models, new Set(['low']), 'opus');
    assert.ok(ids(g.flatMap((x) => x.models)).includes('opus'));
    assert.deepEqual(g.find((x) => x.maker === 'claude').models.map((m) => m.id), ['opus']);
    assert.deepEqual(makerGroups(models, new Set(['low']), 'nope').flatMap((x) => x.models).length, 4, 'an unknown id adds nothing');
});

test('a filter that matches nothing gives no makers, and the input is not changed', () => {
    const before = JSON.stringify(models);
    assert.deepEqual(makerGroups(models.filter((m) => m.credits_per_reply === 1), new Set(['high'])), []);
    makerGroups(models, new Set(['low']));
    assert.equal(JSON.stringify(models), before);
});

test('a new chat opens on the cheapest model, with ties settled by family order, then name', () => {
    assert.equal(defaultModel(models).id, 'luna', 'ChatGPT comes before DeepSeek, Llama and the unknown family among the 1-Credit models');
    assert.equal(defaultModel([M('b', 'claude', 'Claude', 4), M('a', 'claude', 'Claude', 4)]).id, 'a', 'then by name');
    assert.equal(defaultModel([M('x', 'other', 'Other', 1), M('y', 'claude', 'Claude', 2)]).id, 'x', 'price beats family order');
    assert.equal(defaultModel([]), undefined, 'nothing to choose from');
    assert.equal(models[0].id, 'opus', 'the input is not reordered');
});
