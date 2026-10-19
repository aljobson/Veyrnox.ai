import { createSseParser } from '../src/lib/sse';
import { chatApi, cleanOptions, NO_OPTIONS, optionsKey, replyPrice, sendKeyFor, toTurnEvent, type ChatModel } from '../src/lib/chat';
import type { ApiClient } from '../src/lib/api';

describe('sse parser', () => {
    test('parses frames split across chunks', () => {
        const p = createSseParser();
        expect(p.push('event: delta\ndata: {"te')).toEqual([]);
        expect(p.push('xt":"hi"}\n\nevent: done\ndata: {"status":"ok"}\n\n')).toEqual([
            { event: 'delta', data: { text: 'hi' } },
            { event: 'done', data: { status: 'ok' } },
        ]);
    });
    test('handles CRLF and skips malformed JSON', () => {
        const p = createSseParser();
        expect(p.push('event: delta\r\ndata: nope\r\n\r\nevent: delta\r\ndata: {"text":"x"}\r\n\r\n')).toEqual([
            { event: 'delta', data: { text: 'x' } },
        ]);
    });
});

describe('turn events', () => {
    test('maps the server events', () => {
        expect(toTurnEvent('start', { credits: 2, balance_after: 8 })).toEqual({ type: 'start', credits: 2, balanceAfter: 8 });
        expect(toTurnEvent('done', { status: 'succeeded', credits_charged: 2, balance: 8 })).toEqual({
            type: 'done', status: 'succeeded', creditsCharged: 2, balance: 8,
        });
        expect(toTurnEvent('delta', {})).toBeNull();
        expect(toTurnEvent('mystery', {})).toBeNull();
    });
});

function streamOf(text: string): Response {
    const bytes = new TextEncoder().encode(text);
    let sent = false;
    return {
        ok: true,
        status: 200,
        body: { getReader: () => ({ read: async () => (sent ? { done: true, value: undefined } : ((sent = true), { done: false, value: bytes })) }) },
    } as unknown as Response;
}

describe('sendMessage', () => {
    test('posts text and the idempotency key and emits events in order', async () => {
        const stream = jest.fn().mockResolvedValue(streamOf('event: start\ndata: {"credits":1}\n\nevent: delta\ndata: {"text":"Hel"}\n\nevent: delta\ndata: {"text":"lo"}\n\nevent: done\ndata: {"status":"succeeded","credits_charged":1}\n\n'));
        const seen: string[] = [];
        await chatApi({ stream } as unknown as ApiClient).sendMessage('t1', 'hi', 'send-one', (e) => seen.push(e.type === 'delta' ? e.text : e.type));
        expect(seen).toEqual(['start', 'Hel', 'lo', 'done']);
        const [path, init] = stream.mock.calls[0];
        expect(path).toBe('/api/v1/chat/threads/t1/messages');
        expect(JSON.parse(init.body)).toEqual({ text: 'hi', idempotency_key: 'send-one', options: { thinking: false, web: false } });
    });

    test('throws the typed server error before streaming', async () => {
        const stream = jest.fn().mockResolvedValue({ ok: false, status: 402, json: async () => ({ error: 'insufficient_credits' }) });
        await expect(chatApi({ stream } as unknown as ApiClient).sendMessage('t1', 'hi', 'key-12345678', () => {})).rejects.toMatchObject({
            status: 402,
            code: 'insufficient_credits',
        });
    });
});

const model = (options: ChatModel['options']): ChatModel => ({ id: 'm', name: 'M', maker_label: 'X', credits_per_reply: 2, gated: false, options });

describe('reply price', () => {
    const full = model({ thinking: { extra_credits: 1 }, web: { extra_credits: 1 } });
    test('adds the catalog extra for each choice', () => {
        expect(replyPrice(full, NO_OPTIONS)).toBe(2);
        expect(replyPrice(full, { thinking: true, web: false })).toBe(3);
        expect(replyPrice(full, { thinking: false, web: true })).toBe(3);
        expect(replyPrice(full, { thinking: true, web: true })).toBe(4);
    });
    test('a choice the model does not offer adds nothing and is dropped', () => {
        const plain = model({ thinking: null, web: { extra_credits: 1 } });
        expect(cleanOptions(plain, { thinking: true, web: true })).toEqual({ thinking: false, web: true });
        expect(replyPrice(plain, { thinking: true, web: true })).toBe(3);
        expect(replyPrice(model(undefined), { thinking: true, web: true })).toBe(2);
    });
    test('a bad extra from the server is not offered', () => {
        expect(replyPrice(model({ thinking: { extra_credits: 0 }, web: { extra_credits: -1 } }), { thinking: true, web: true })).toBe(2);
    });
});

describe('send keys', () => {
    let n = 0;
    const make = () => `key-${++n}`;
    test('the same text with the same choices reuses its key, so a retry is charged once', () => {
        const first = sendKeyFor(null, 'hi', NO_OPTIONS, make);
        expect(sendKeyFor(first, 'hi', { thinking: false, web: false }, make).key).toBe(first.key);
    });
    test('different text or different choices make a new key', () => {
        const first = sendKeyFor(null, 'hi', NO_OPTIONS, make);
        expect(sendKeyFor(first, 'hello', NO_OPTIONS, make).key).not.toBe(first.key);
        expect(sendKeyFor(first, 'hi', { thinking: true, web: false }, make).key).not.toBe(first.key);
        expect(optionsKey({ thinking: true, web: true })).toBe('tw');
    });
});

describe('sendMessage options', () => {
    test('sends the chosen options', async () => {
        const stream = jest.fn().mockResolvedValue(streamOf('event: done\ndata: {"status":"succeeded"}\n\n'));
        await chatApi({ stream } as unknown as ApiClient).sendMessage('t1', 'hi', 'key-12345678', () => {}, undefined, { thinking: true, web: true });
        expect(JSON.parse(stream.mock.calls[0][1].body).options).toEqual({ thinking: true, web: true });
    });
});
