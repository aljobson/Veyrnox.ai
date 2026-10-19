import { createSseParser } from '../src/lib/sse';
import { chatApi, cleanOptions, cleanTitle, NO_OPTIONS, pinnedFirst, optionsKey, replyPrice, sendKeyFor, toTurnEvent, type ChatModel } from '../src/lib/chat';
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
        expect(toTurnEvent('start', { credits: 2, balance_after: 8 })).toEqual({ type: 'start', credits: 2, balanceAfter: 8, jobId: null });
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

describe('thread edits', () => {
    test('a title is trimmed and held to 1 to 120 characters', () => {
        expect(cleanTitle('  Hello  ')).toBe('Hello');
        expect(cleanTitle('   ')).toBeNull();
        expect(cleanTitle('x'.repeat(121))).toBeNull();
        expect(cleanTitle('x'.repeat(120))).not.toBeNull();
    });
    test('pinned chats come first and keep their order', () => {
        const rows = [{ id: 'a', pinned: false }, { id: 'b', pinned: true }, { id: 'c', pinned: false }, { id: 'd', pinned: true }];
        expect(pinnedFirst(rows).map((r) => r.id)).toEqual(['b', 'd', 'a', 'c']);
    });
    test('rename and pin are PATCHes with only the changed key', async () => {
        const request = jest.fn().mockResolvedValue({ thread: { id: 't' } });
        await chatApi({ request } as unknown as ApiClient).updateThread('t', { pinned: true });
        expect(request.mock.calls[0][0]).toBe('/api/v1/chat/threads/t');
        expect(request.mock.calls[0][1].method).toBe('PATCH');
        expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ pinned: true });
    });
    test('the stop question posts the send key to chat/sends/close', async () => {
        const request = jest.fn().mockResolvedValue({ closed: true });
        await chatApi({ request } as unknown as ApiClient).closeSend('vx-key');
        expect(request.mock.calls[0][0]).toBe('/api/v1/chat/sends/close');
        expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ idempotency_key: 'vx-key' });
    });
});

describe('one charge on a retry', () => {
    test('the retry of an unsettled send goes out with the same key and the same body', async () => {
        const bodies: string[] = [];
        const stream = jest.fn(async (_p: string, init: RequestInit) => {
            bodies.push(String(init.body));
            return streamOf('event: done\ndata: {"status":"succeeded"}\n\n');
        });
        const api = chatApi({ stream } as unknown as ApiClient);
        const first = sendKeyFor(null, 'hi', NO_OPTIONS, () => 'vx-key-a');
        await api.sendMessage('t', 'hi', first.key, () => {}, undefined, NO_OPTIONS);
        const retry = sendKeyFor(first, 'hi', NO_OPTIONS, () => 'vx-key-b');
        await api.sendMessage('t', 'hi', retry.key, () => {}, undefined, NO_OPTIONS);
        expect(bodies[1]).toBe(bodies[0]);
        expect(JSON.parse(bodies[1]).idempotency_key).toBe('vx-key-a');
    });
});

describe('replay and cut-off streams', () => {
    const answer = (type: string, body: unknown) => ({ ok: true, status: 200, headers: { get: () => type }, json: async () => body }) as unknown as Response;
    test('a JSON replay answer names the job and is not taken for a finished reply', async () => {
        const stream = jest.fn().mockResolvedValue(answer('application/json', { replay: true, job_id: 'job-1' }));
        await expect(chatApi({ stream } as unknown as ApiClient).sendMessage('t', 'hi', 'vx-k', () => {})).resolves.toEqual({ replay: true, job: 'job-1' });
    });
    test('JSON that is not a replay is no answer', async () => {
        const stream = jest.fn().mockResolvedValue(answer('application/json', {}));
        await expect(chatApi({ stream } as unknown as ApiClient).sendMessage('t', 'hi', 'vx-k', () => {})).rejects.toMatchObject({ status: 0 });
    });
    test('a stream that ends with no done was cut off', async () => {
        const stream = jest.fn().mockResolvedValue(streamOf('event: delta\ndata: {"text":"Hel"}\n\n'));
        await expect(chatApi({ stream } as unknown as ApiClient).sendMessage('t', 'hi', 'vx-k', () => {})).rejects.toMatchObject({ status: 0, code: 'stream_cut' });
    });
});
