import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { turnOptions } from '../app/veyrnox/_lib/chatTurnOptions.js';

// Deep research (ADR-0070) was dropped between the UI and the request: the button said 7 Credits, the server never saw `research`.

test('a Deep research choice reaches the request, alone', () => {
    assert.deepEqual(turnOptions({ research: true }), { thinking: false, web: false, research: true });
});

test('a turn without research keeps exactly the shape it always had (no research key at all)', () => {
    assert.deepEqual(turnOptions({ thinking: true, web: false }), { thinking: true, web: false });
    assert.deepEqual(turnOptions({ research: false, web: true }), { thinking: false, web: true });
    assert.deepEqual(turnOptions(undefined), { thinking: false, web: false });
    assert.deepEqual(turnOptions({}), { thinking: false, web: false });
    assert.ok(!('research' in turnOptions({ research: 'yes' })), 'only the boolean true counts');
});

test('sendTurn builds its body from turnOptions, not from its own thinking/web pair', () => {
    const src = readFileSync(new URL('../app/veyrnox/_lib/chatApi.js', import.meta.url), 'utf8');
    assert.match(src, /options: turnOptions\(options\)/);
    assert.match(src, /import \{ turnOptions \} from '\.\/chatTurnOptions'/);
    assert.doesNotMatch(src, /options: \{ thinking: options\?\.thinking === true, web: options\?\.web === true \}/);
});

test('the server accepts exactly the shape the client now sends', async () => {
    const { validateTurn } = await import('../lib/chat.js');
    const base = { text: 'q', idempotency_key: 'k'.repeat(16) };
    const ok = validateTurn({ ...base, options: turnOptions({ research: true }) });
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.equal(ok.options.research, true);
    const plain = validateTurn({ ...base, options: turnOptions({}) });
    assert.equal(plain.ok, true);
    assert.ok(!('research' in plain.options));
});
