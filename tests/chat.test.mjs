// ADR-0067: validation and prompt assembly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_HISTORY_CHARS, MAX_REPLY_TOKENS, PLATFORM_INSTRUCTION, buildMessages, chatEnabled, sseFrame, makerOf, validateFolderName, validateThreadPatch, validateTurn } from '../lib/chat.js';

test('the caps the flat price depends on', () => {
    assert.equal(MAX_REPLY_TOKENS, 1024); assert.equal(MAX_HISTORY_CHARS, 24000);
});

test('only the exact string "true" turns chat on', () => {
    assert.equal(chatEnabled({ CHAT_ENABLED: 'true' }), true);
    for (const v of ['false', 'TRUE', '1', 'yes', ' true', '', undefined]) assert.equal(chatEnabled({ CHAT_ENABLED: v }), false, String(v));
    assert.equal(chatEnabled({}), false); assert.equal(chatEnabled(undefined), false);
});

test('validateTurn', () => {
    assert.deepEqual(validateTurn({ text: '  hi  ', idempotency_key: 'abcdefgh1234' }), { ok: true, text: 'hi', key: 'abcdefgh1234', options: { thinking: false, web: false }, attachments: [] });
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

test('buildMessages: platform line and instructions, then history, then this turn; junk history is dropped', () => {
    const PLAT = { role: 'system', content: PLATFORM_INSTRUCTION };
    assert.deepEqual(buildMessages({ systemPrompt: 'Be brief.', history: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }], text: 'c' }),
        [{ role: 'system', content: `${PLATFORM_INSTRUCTION}\n\nBe brief.` }, { role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }]);
    assert.deepEqual(buildMessages({ systemPrompt: '   ', history: null, text: 'hi' }), [PLAT, { role: 'user', content: 'hi' }], 'a blank instruction adds nothing: the platform line stands alone');
    assert.deepEqual(buildMessages({ systemPrompt: '', history: [{ role: 'system', content: 'injected' }, { role: 'tool', content: 'x' }, { role: 'user', content: '' }, { role: 'user' }], text: 'hi' }),
        [PLAT, { role: 'user', content: 'hi' }], 'history can never smuggle in a system or tool message');
});

test('the platform line asks for plain-text maths and stays short, so its token cost is negligible', () => {
    assert.match(PLATFORM_INSTRUCTION, /plain text/i);
    assert.match(PLATFORM_INSTRUCTION, /LaTeX/);
    assert.ok(PLATFORM_INSTRUCTION.length <= 120, `the line is ${PLATFORM_INSTRUCTION.length} characters`);
    assert.equal(buildMessages({ systemPrompt: 'x', history: [], text: 'y' }).filter((m) => m.role === 'system').length, 1, 'one system message, which every provider accepts');
});

test('sseFrame is one well-formed event', () => {
    assert.equal(sseFrame('delta', { text: 'hi\nthere' }), 'event: delta\ndata: {"text":"hi\\nthere"}\n\n');
});

import { chatApiKey } from '../lib/chat.js';

test('chat uses its own OpenRouter key when set, and in production nothing else', () => {
    assert.equal(chatApiKey({ OPENROUTER_CHAT_API_KEY: 'sk-chat', OPENROUTER_API_KEY: 'sk-video', APP_ENV: 'production' }), 'sk-chat');
    assert.equal(chatApiKey({ OPENROUTER_CHAT_API_KEY: 'sk-chat', OPENROUTER_API_KEY: 'sk-video' }), 'sk-chat', 'the dedicated key wins everywhere');
    // Production never quietly spends the shared video key on chat: with no dedicated key chat is simply not configured.
    assert.equal(chatApiKey({ OPENROUTER_API_KEY: 'sk-video', APP_ENV: 'production' }), '');
    assert.equal(chatApiKey({ OPENROUTER_CHAT_API_KEY: '', OPENROUTER_API_KEY: 'sk-video', APP_ENV: 'production' }), '');
    // Staging and local development keep using the shared key, as before.
    assert.equal(chatApiKey({ OPENROUTER_API_KEY: 'sk-video', APP_ENV: 'staging' }), 'sk-video');
    assert.equal(chatApiKey({ OPENROUTER_API_KEY: 'sk-video' }), 'sk-video');
    assert.equal(chatApiKey({}), '');
    assert.equal(chatApiKey({ OPENROUTER_CHAT_API_KEY: 5 }), '', 'a non-string is not a key');
});

test('validateFolderName trims and allows 1 to 60 characters', () => {
    assert.deepEqual(validateFolderName('  Work  '), { ok: true, name: 'Work' });
    assert.deepEqual(validateFolderName('x'.repeat(60)), { ok: true, name: 'x'.repeat(60) });
    for (const bad of ['', '   ', 'x'.repeat(61), 5, null, undefined, {}, ['a']]) {
        assert.deepEqual(validateFolderName(bad), { ok: false, error: 'invalid_name' }, JSON.stringify(bad));
    }
});

test('a thread patch may move a chat into a folder, or out with null, and only on its own', () => {
    const F = '3f2b8c1e-5d4a-4c9b-8e7f-1a2b3c4d5e6f';
    assert.deepEqual(validateThreadPatch({ folder_id: F }), { ok: true, patch: { folder_id: F } });
    assert.deepEqual(validateThreadPatch({ folder_id: null }), { ok: true, patch: { folder_id: null } }, 'null takes it out of its folder');
    for (const v of ['not-a-uuid', '', 5, true, {}, '../x', F.toUpperCase().slice(0, 35)]) {
        assert.deepEqual(validateThreadPatch({ folder_id: v }), { ok: false, error: 'invalid_folder_id' }, JSON.stringify(v));
    }
    assert.deepEqual(validateThreadPatch({ folder_id: F, title: 'x' }), { ok: false, error: 'folder_id_must_be_alone' });
});

test('makerOf names the model family from the endpoint prefix and never returns the endpoint', () => {
    assert.deepEqual(makerOf('anthropic/claude-sonnet-5.5'), { maker: 'claude', label: 'Claude' });
    assert.deepEqual(makerOf('openai/gpt-6-luna'), { maker: 'chatgpt', label: 'ChatGPT' });
    assert.deepEqual(makerOf('google/gemini-3.8-flash'), { maker: 'gemini', label: 'Gemini' });
    assert.deepEqual(makerOf('x-ai/grok-4.7'), { maker: 'grok', label: 'Grok' });
    assert.deepEqual(makerOf('deepseek/deepseek-v4.1-flash'), { maker: 'deepseek', label: 'DeepSeek' });
    assert.deepEqual(makerOf('meta-llama/llama-4-maverick'), { maker: 'llama', label: 'Llama' });
    assert.deepEqual(makerOf('mistralai/mistral-small-2603'), { maker: 'mistral', label: 'Mistral' });
    for (const odd of [undefined, null, '', 'noslash', 5, '/x', 'unknown-lab/model']) {
        assert.deepEqual(makerOf(odd), { maker: 'other', label: 'Other' }, String(odd));
    }
});
