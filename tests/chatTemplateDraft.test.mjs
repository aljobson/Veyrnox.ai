import { test } from 'node:test';
import assert from 'node:assert/strict';
import { takeTemplateChatDraft, writeTemplateChatDraft } from '../app/veyrnox/_lib/chatTemplateDraft.js';

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test('an edited template prompt is carried into chat once without a URL payload', () => {
  const s = storage();
  assert.equal(writeTemplateChatDraft(s, { id: 'birthday-highlight-reel' }, '  Keep the whole edited prompt  ', 1000), true);
  assert.deepEqual(takeTemplateChatDraft(s, 1001), { templateId: 'birthday-highlight-reel', prompt: 'Keep the whole edited prompt' });
  assert.equal(takeTemplateChatDraft(s, 1002), null);
});

test('template chat handoffs are bounded and stale or malformed values are rejected', () => {
  const s = storage();
  assert.equal(writeTemplateChatDraft(s, { id: 'template' }, 'x'.repeat(2500), 1000), true);
  assert.equal(takeTemplateChatDraft(s, 1001).prompt.length, 2000);

  assert.equal(writeTemplateChatDraft(s, { id: 'template' }, 'old', 1000), true);
  assert.equal(takeTemplateChatDraft(s, 1000 + (10 * 60 * 1000) + 1), null);
  assert.equal(writeTemplateChatDraft(s, {}, 'prompt', 1000), false);
  assert.equal(writeTemplateChatDraft(s, { id: 'template' }, '   ', 1000), false);
  assert.equal(writeTemplateChatDraft(null, { id: 'template' }, 'prompt', 1000), false);
});

test('blocked browser storage fails safely', () => {
  const blocked = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); },
  };
  assert.equal(writeTemplateChatDraft(blocked, { id: 'template' }, 'prompt'), false);
  assert.equal(takeTemplateChatDraft(blocked), null);
});
