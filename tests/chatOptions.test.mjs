// ADR-0067 amendment 2: Thinking and Web search are priced options stored on the catalog row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTurn, replyBudget, replyPrice, sourcesMarkdown } from '../lib/chat.js';

const ROW = {
    credits_5s: 4, chat_max_reply_tokens: 4096, chat_reasoning_effort: 'low',
    chat_thinking_effort: 'high', chat_thinking_max_reply_tokens: 8192, chat_thinking_extra_credits: 3,
    chat_web_extra_credits: 3,
};
const turn = (extra) => ({ text: 'hi', idempotency_key: 'key-0123456789', ...extra });

test('options default to off and accept only the two booleans', () => {
    assert.deepEqual(validateTurn(turn()).options, { thinking: false, web: false });
    assert.deepEqual(validateTurn(turn({ options: { thinking: true } })).options, { thinking: true, web: false });
    assert.deepEqual(validateTurn(turn({ options: { thinking: true, web: true } })).options, { thinking: true, web: true });
    for (const bad of [true, 'yes', [], { thinking: 'true' }, { web: 1 }, { thinking: true, cheap: true }, null]) {
        assert.deepEqual(validateTurn(turn({ options: bad })), { ok: false, error: 'invalid_options' }, JSON.stringify(bad));
    }
});

test('the price is the catalog base plus the catalog extra for each option chosen', () => {
    assert.deepEqual(replyPrice(ROW, { thinking: false, web: false }), { ok: true, credits: 4 });
    assert.deepEqual(replyPrice(ROW, { thinking: true, web: false }), { ok: true, credits: 7 });
    assert.deepEqual(replyPrice(ROW, { thinking: false, web: true }), { ok: true, credits: 7 });
    assert.deepEqual(replyPrice(ROW, { thinking: true, web: true }), { ok: true, credits: 10 });
});

test('an option the row does not offer is refused, not priced at zero', () => {
    const noThinking = { credits_5s: 1 };
    assert.deepEqual(replyPrice(noThinking, { thinking: true, web: false }), { ok: false, error: 'option_unavailable' });
    assert.deepEqual(replyPrice(noThinking, { thinking: false, web: true }), { ok: false, error: 'option_unavailable' });
    assert.deepEqual(replyPrice({ credits_5s: 1, chat_thinking_effort: 'high', chat_thinking_max_reply_tokens: 8192 }, { thinking: true, web: false }),
        { ok: false, error: 'option_unavailable' }, 'a half-configured option is not offered');
    assert.deepEqual(replyPrice({ credits_5s: 0 }, {}), { ok: false, error: 'model_unavailable' });
});

test('thinking swaps in the row\'s thinking cap and effort; web search changes neither', () => {
    assert.deepEqual(replyBudget(ROW, { thinking: false, web: false }), { maxTokens: 4096, reasoningEffort: 'low' });
    assert.deepEqual(replyBudget(ROW, { thinking: true, web: false }), { maxTokens: 8192, reasoningEffort: 'high' });
    assert.deepEqual(replyBudget(ROW, { thinking: false, web: true }), { maxTokens: 4096, reasoningEffort: 'low' });
    assert.deepEqual(replyBudget({ ...ROW, chat_thinking_effort: null }, { thinking: true }), { maxTokens: 4096, reasoningEffort: 'low' });
});

test('sources become a short markdown list: https only, deduplicated, titles cleaned, capped', () => {
    assert.equal(sourcesMarkdown([]), '');
    assert.equal(sourcesMarkdown(undefined), '');
    const md = sourcesMarkdown([
        { url: 'https://nodejs.org/en/blog/release/v26.10.0', title: 'Node.js — 26.10.0 [Current]\nrelease' },
        { url: 'https://nodejs.org/en/blog/release/v26.10.0', title: 'duplicate' },
        { url: 'javascript:alert(1)', title: 'bad' },
        { url: 'http://insecure.example/x', title: 'plain http' },
        { url: 'https://example.com/a_(b)', title: '' },
        { url: 'not a url', title: 'junk' },
    ]);
    assert.equal(md, '\n\nSources\n- [Node.js — 26.10.0 Current release](https://nodejs.org/en/blog/release/v26.10.0)\n- [plain http](http://insecure.example/x)\n- [example.com](https://example.com/a_%28b%29)');
    const many = Array.from({ length: 20 }, (_, i) => ({ url: `https://s${i}.example/`, title: `S${i}` }));
    assert.equal(sourcesMarkdown(many).split('\n- ').length - 1, 8);
});

// ---- Image attachments (ADR-0068) ----
import { buildMessages, rowOptions, MAX_ATTACHMENTS, MAX_IMAGE_EDGE } from '../lib/chat.js';
const KEY = (n) => `uploads/11111111-1111-4111-8111-111111111111/2222222${n}-2222-4222-8222-222222222222.png`;

test('attachments default to none and accept up to four distinct owner keys', () => {
    assert.deepEqual(validateTurn(turn()).attachments, []);
    assert.deepEqual(validateTurn(turn({ attachments: [] })).attachments, []);
    assert.deepEqual(validateTurn(turn({ attachments: [{ source_key: KEY(1) }, { source_key: KEY(2) }] })).attachments, [KEY(1), KEY(2)]);
    assert.equal(MAX_ATTACHMENTS, 4);
    assert.equal(MAX_IMAGE_EDGE, 2048);
});

test('malformed attachments are refused', () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ source_key: KEY(i) }));
    for (const bad of [five, 'x', {}, [null], ['k'], [{}], [{ source_key: 5 }], [{ source_key: '' }], [{ source_key: KEY(1) }, { source_key: KEY(1) }],
        [{ source_key: KEY(1), extra: true }], [{ source_key: 'x'.repeat(300) }]]) {
        assert.deepEqual(validateTurn(turn({ attachments: bad })), { ok: false, error: 'invalid_attachments' }, JSON.stringify(bad).slice(0, 60));
    }
});

const A1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const A2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

test('a Library image is named by its job id; `assets` appears only when there are some (ADR-0068 amendment 2)', () => {
    const only = validateTurn(turn({ attachments: [{ source_asset: A1 }] }));
    assert.deepEqual(only.attachments, []);
    assert.deepEqual(only.assets, [A1]);
    const mixed = validateTurn(turn({ attachments: [{ source_key: KEY(1) }, { source_asset: A2 }, { source_key: KEY(2) }, { source_asset: A1 }] }));
    assert.deepEqual(mixed.attachments, [KEY(1), KEY(2)]);
    assert.deepEqual(mixed.assets, [A2, A1]);
    assert.equal('assets' in validateTurn(turn({ attachments: [{ source_key: KEY(1) }] })), false, 'a turn without assets keeps its old shape');
    assert.equal('assets' in validateTurn(turn()), false);
    assert.deepEqual(validateTurn(turn({ attachments: [{ source_asset: A1.toUpperCase() }] })).assets, [A1], 'ids are compared in lower case');
});

test('malformed Library attachments are refused, and four is the most in all', () => {
    const five = [{ source_key: KEY(1) }, { source_key: KEY(2) }, { source_asset: A1 }, { source_asset: A2 }, { source_asset: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }];
    for (const bad of [five, [{ source_asset: 'not-a-uuid' }], [{ source_asset: 5 }], [{ source_asset: '' }], [{ source_asset: A1 }, { source_asset: A1 }],
        [{ source_asset: A1 }, { source_asset: A1.toUpperCase() }], [{ source_asset: A1, source_key: KEY(1) }], [{ source_asset: A1, extra: true }], [{ asset: A1 }]]) {
        assert.deepEqual(validateTurn(turn({ attachments: bad })), { ok: false, error: 'invalid_attachments' }, JSON.stringify(bad).slice(0, 70));
    }
});

test('the images option is priced from the catalog and refused where it is not offered', () => {
    const withImages = { ...ROW, chat_images_extra_credits: 3 };
    assert.deepEqual(replyPrice(withImages, { images: true }), { ok: true, credits: 7 });
    assert.deepEqual(replyPrice(withImages, { thinking: true, web: true, images: true }), { ok: true, credits: 13 });
    assert.deepEqual(replyPrice(ROW, { images: true }), { ok: false, error: 'option_unavailable' });
    assert.deepEqual(replyPrice(withImages, { images: false }), { ok: true, credits: 4 });
    assert.deepEqual(rowOptions(withImages).images, { extra_credits: 3 });
    assert.equal(rowOptions(ROW).images, null);
});

test('images join the last user message as content parts, after the text', () => {
    const m = buildMessages({ systemPrompt: 'Be brief.', history: [{ role: 'user', content: 'earlier' }], text: 'What is this?', images: ['https://r2.example/a?sig=1', 'https://r2.example/b?sig=2'] });
    assert.deepEqual(m.at(-1), { role: 'user', content: [
        { type: 'text', text: 'What is this?' },
        { type: 'image_url', image_url: { url: 'https://r2.example/a?sig=1' } },
        { type: 'image_url', image_url: { url: 'https://r2.example/b?sig=2' } },
    ] });
    assert.equal(m[1].content, 'earlier', 'history stays plain text');
    assert.equal(buildMessages({ systemPrompt: '', history: [], text: 'hi' }).at(-1).content, 'hi', 'no images, no change');
});
