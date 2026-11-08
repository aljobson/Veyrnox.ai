// ADR-0332: a catalog row priced for one editor job (id starting "editor-") must never appear in, or be usable from, Chat.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { editorOnlyModel, EDITOR_ONLY_PREFIX } from '../lib/chat.js';

test('only ids that start with the editor prefix are editor-only', () => {
    assert.equal(EDITOR_ONLY_PREFIX, 'editor-');
    assert.equal(editorOnlyModel('editor-ai-edit-gemini-3.8-flash'), true);
    for (const id of ['chat-gemini-3.8-flash', 'my-editor-row', 'Editor-x', '', undefined, null, 7]) assert.equal(editorOnlyModel(id), false, String(id));
});

test('the Chat model list filters editor-only rows out in the query itself', () => {
    const source = readFileSync(new URL('../app/api/v1/chat/models/route.js', import.meta.url), 'utf8');
    assert.match(source, /provider=eq\.openrouter-chat&id=not\.like\.editor-\*&order=name\.asc/);
});

test('a thread cannot be created on an editor-only model', async () => {
    const source = readFileSync(new URL('../app/api/v1/chat/threads/route.js', import.meta.url), 'utf8');
    assert.match(source, /editorOnlyModel\(body\.model_id\)\) return reply\(\{ error: 'model_unavailable' \}, 404\)/);
    assert.ok(source.indexOf('editorOnlyModel(body.model_id)') < source.indexOf("rpc('chat_create_thread'"), 'refused before the database is called');
});

test('the editor AI edit still reads its own row, which Chat cannot', () => {
    const source = readFileSync(new URL('../lib/editorAiEdit.js', import.meta.url), 'utf8');
    assert.match(source, /provider=eq\.openrouter-chat/); // same provider, different id space
    assert.doesNotMatch(source, /editorOnlyModel/);
});
