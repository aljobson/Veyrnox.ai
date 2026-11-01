import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hostOf, fromPerplexity, fromOpenAI, fromAnthropic, score, summarise } from '../scripts/lib/aeo-citations.mjs';

test('hostOf lowercases, drops www and refuses non-web addresses', () => {
    assert.equal(hostOf('https://WWW.Veyrnox.ai/pricing'), 'veyrnox.ai');
    for (const bad of ['javascript:alert(1)', 'not a url', '', undefined]) assert.equal(hostOf(bad), null);
});

test('each engine shape yields the answer text and de-duplicated addresses', () => {
    const p = fromPerplexity({ choices: [{ message: { content: 'A' } }], citations: ['https://a.com/x', 'https://a.com/x'], search_results: [{ url: 'https://b.com/' }] });
    assert.deepEqual([p.text, p.urls], ['A', ['https://a.com/x', 'https://b.com/']]);
    const o = fromOpenAI({ output: [{ type: 'web_search_call' }, { type: 'message', content: [{ text: 'B', annotations: [{ type: 'url_citation', url: 'https://c.com/' }, { type: 'other', url: 'https://no.com/' }] }] }] });
    assert.deepEqual([o.text, o.urls], ['B', ['https://c.com/']]);
    const a = fromAnthropic({ content: [
        { type: 'web_search_tool_result', content: [{ url: 'https://d.com/' }] },
        { type: 'text', text: 'C', citations: [{ url: 'https://e.com/' }] },
    ] });
    assert.deepEqual([a.text, a.urls, a.cited], ['C', ['https://e.com/', 'https://d.com/'], ['https://e.com/']]);
});

test('malformed responses give an empty answer rather than throwing', () => {
    for (const fn of [fromPerplexity, fromOpenAI, fromAnthropic]) assert.deepEqual(fn(null).urls, []);
});

test('score separates our links from everyone else', () => {
    const s = score({ text: 'Try Veyrnox.ai', urls: ['https://veyrnox.ai/models', 'https://www.example.com/a', 'https://example.com/b'] });
    assert.deepEqual([s.mentioned, s.cited, s.ownUrls, s.otherHosts], [true, true, ['https://veyrnox.ai/models'], ['example.com']]);
    assert.equal(score({ text: 'nothing', urls: [] }).cited, false);
});

test('summarise counts per engine and kind and skips failed rows', () => {
    const row = (engine, kind, mentioned, cited, otherHosts, error) => ({ engine, kind, error, score: { mentioned, cited, otherHosts } });
    const out = summarise([
        row('openai', 'unbranded', false, false, ['a.com', 'b.com']),
        row('openai', 'unbranded', true, true, ['a.com']),
        row('openai', 'unbranded', false, false, [], 'HTTP 500'),
    ]);
    assert.deepEqual(out.openai.unbranded, { answers: 2, mentioned: 1, cited: 1, topHosts: [['a.com', 2], ['b.com', 1]] });
});

test('the question list is well formed and keeps wallet vocabulary out', () => {
    const qs = JSON.parse(readFileSync(new URL('../scripts/aeo/questions.json', import.meta.url), 'utf8'));
    assert.ok(qs.length >= 15);
    assert.equal(new Set(qs.map((q) => q.id)).size, qs.length);
    for (const q of qs) {
        assert.ok(['branded', 'unbranded'].includes(q.kind), q.id);
        assert.equal(/veyrnox/i.test(q.q), q.kind === 'branded', `${q.id}: branded questions name us, unbranded ones do not`);
        assert.doesNotMatch(q.q, /wallet|crypto|on-chain|token/i);
    }
});
