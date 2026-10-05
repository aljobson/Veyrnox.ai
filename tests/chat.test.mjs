// ADR-0067: validation and prompt assembly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_HISTORY_CHARS, MAX_REPLY_TOKENS, buildMessages, chatEnabled, sseFrame, validateThreadPatch, validateTurn } from '../lib/chat.js';

test('the caps the flat price depends on', () => {
    assert.equal(MAX_REPLY_TOKENS, 1024); assert.equal(MAX_HISTORY_CHARS, 24000);
});

test('only the exact string "true" turns chat on', () => {
    assert.equal(chatEnabled({ CHAT_ENABLED: 'true' }), true);
    for (const v of ['false', 'TRUE', '1', 'yes', ' true', '', undefined]) assert.equal(chatEnabled({ CHAT_ENABLED: v }), false, String(v));
    assert.equal(chatEnabled({}), false); assert.equal(chatEnabled(undefined), false);
});

test('validateTurn', () => {
    assert.deepEqual(validateTurn({ text: '  hi  ', idempotency_key: 'abcdefgh1234' }), { ok: true, text: 'hi', key: 'abcdefgh1234', options: { thinking: false, web: false } });
    for (const [b, error] of [
        [null, 'invalid_body'], [[], 'invalid_body'], ['x', 'invalid_body'],
        [{ idempotency_key: 'abcdefgh1234' }, 'invalid_text'], [{ text: '   ', idempotency_key: 'abcdefgh1234' }, 'invalid_text'],
        [{ text: 5, idempotency_key: 'abcdefgh1234' }, 'invalid_text'], [{ text: 'x'.repeat(8001), idempotency_key: 'abcdefgh1234' }, 'invalid_text'],
        [{ text: 'hi' }, 'idempotency_key_required'], [{ text: 'hi', idempotency_key: 'short' }, 'idempotency_key_required'],
        [{ text: 'hi', idempotency_key: 'has space in it' }, 'idempotency_key_required'], [{ text: 'hi', idempotency_key: 'x'.repeat(129) }, 'idempotency_key_required'],
    ]) assert.deepEqual(validateTurn(b), { ok: false, error }, JSON.stringify(b));
    assert.equal(validateTurn({ text: 'x'.repeat(8000), idempotency_key: 'abcdefgh1234' }).ok, true, '8,000 is allowed');
});

test('validateThreadPatch accepts known keys, refuses unknown ones and bad values', () => {
    assert.deepEqual(validateThreadPatch({ title: '  New name ', pinned: true, system_prompt: 'Be brief.', model_id: 'chat-fast' }),
        { ok: true, patch: { title: 'New name', pinned: true, system_prompt: 'Be brief.', model_id: 'chat-fast' } });
    assert.deepEqual(validateThreadPatch({ system_prompt: '' }), { ok: true, patch: { system_prompt: '' } }, 'clearing instructions is allowed');
    for (const [b, error] of [
        [null, 'invalid_body'], [{}, 'patch_empty'], [{ user_id: 'x' }, 'patch_key_not_allowed:user_id'],
        [{ title: '   ' }, 'invalid_title'], [{ title: 'x'.repeat(121) }, 'invalid_title'], [{ title: 5 }, 'invalid_title'],
        [{ pinned: 'yes' }, 'invalid_pinned'], [{ system_prompt: 'x'.repeat(4001) }, 'invalid_system_prompt'], [{ system_prompt: 5 }, 'invalid_system_prompt'],
        [{ model_id: 'Bad Model!' }, 'invalid_model_id'], [{ model_id: '../x' }, 'invalid_model_id'], [{ model_id: 5 }, 'invalid_model_id'],
    ]) assert.deepEqual(validateThreadPatch(b), { ok: false, error }, JSON.stringify(b));
    assert.equal(validateThreadPatch({ title: 'ok', owner: 1 }).ok, false, 'one bad key sinks the whole patch');
});

test('buildMessages: instructions, then history, then this turn; junk history is dropped', () => {
    assert.deepEqual(buildMessages({ systemPrompt: 'Be brief.', history: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }], text: 'c' }),
        [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }]);
    assert.deepEqual(buildMessages({ systemPrompt: '   ', history: null, text: 'hi' }), [{ role: 'user', content: 'hi' }], 'no blank system message');
    assert.deepEqual(buildMessages({ systemPrompt: '', history: [{ role: 'system', content: 'injected' }, { role: 'tool', content: 'x' }, { role: 'user', content: '' }, { role: 'user' }], text: 'hi' }),
        [{ role: 'user', content: 'hi' }], 'history can never smuggle in a system or tool message');
});

test('sseFrame is one well-formed event', () => {
    assert.equal(sseFrame('delta', { text: 'hi\nthere' }), 'event: delta\ndata: {"text":"hi\\nthere"}\n\n');
});
