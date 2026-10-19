import type { ChatMessage } from '../src/lib/chat';
import { askStoppedSend, findSavedTurn, makeSendKey, resolveStoppedSend, SEND_KEY_RE, settleStoppedTurn, stopNoticeKey } from '../src/lib/chatStop';

const msg = (id: string, role: 'user' | 'assistant', content: string): ChatMessage => ({ id, role, content });
const JOB = '0b1f6e5a-1c2d-4e3f-8a9b-0c1d2e3f4a5b';
const noWait = async () => undefined;
const known = new Set(['k1', 'k2']);
const saved = [msg('k1', 'user', 'old'), msg('k2', 'assistant', 'old reply'), msg('n1', 'user', 'hi'), msg('n2', 'assistant', 'partial')];

describe('findSavedTurn', () => {
    test('finds the new question and the reply after it', () => {
        expect(findSavedTurn(saved, known, 'hi')?.reply.id).toBe('n2');
    });
    test('ignores turns already on screen and different text', () => {
        expect(findSavedTurn(saved, known, 'old')).toBeNull();
        expect(findSavedTurn(saved, known, 'other')).toBeNull();
    });
});

describe('settleStoppedTurn', () => {
    const base = { text: 'hi', knownIds: known, wait: noWait, waits: [1, 1, 1] };
    test('a succeeded job is saved, or unsaved when the reply could not be stored', async () => {
        const getThread = jest.fn();
        expect(await settleStoppedTurn({ ...base, jobId: JOB, getThread, getJob: async () => ({ state: 'succeeded' }) })).toBe('saved');
        expect(await settleStoppedTurn({ ...base, jobId: JOB, getThread, getJob: async () => ({ state: 'succeeded', error_code: 'reply_not_saved' }) })).toBe('unsaved');
        expect(getThread).not.toHaveBeenCalled();
    });
    test('waits while the job is running, then reports what it finds', async () => {
        const states = ['running', 'running', 'succeeded'];
        const getJob = jest.fn(async () => ({ state: states.shift() }));
        expect(await settleStoppedTurn({ ...base, jobId: JOB, getThread: jest.fn(), getJob })).toBe('saved');
        expect(getJob).toHaveBeenCalledTimes(3);
    });
    test('a failed and refunded job that kept nothing is nothing', async () => {
        const out = await settleStoppedTurn({ ...base, jobId: JOB, getThread: async () => ({ messages: [msg('k1', 'user', 'old')] }), getJob: async () => ({ state: 'failed', refunded: true }) });
        expect(out).toBe('nothing');
    });
    test('a failed job that still stored a reply is saved', async () => {
        const out = await settleStoppedTurn({ ...base, jobId: JOB, getThread: async () => ({ messages: saved }), getJob: async () => ({ state: 'failed', refunded: true }) });
        expect(out).toBe('saved');
    });
    test('unsettled when the tries run out', async () => {
        expect(await settleStoppedTurn({ ...base, jobId: JOB, getThread: jest.fn(), getJob: async () => ({ state: 'running' }) })).toBe('pending');
    });
    test('failed reads are not answers', async () => {
        const getJob = jest.fn().mockRejectedValue(new Error('offline'));
        const getThread = jest.fn().mockRejectedValue(new Error('offline'));
        expect(await settleStoppedTurn({ ...base, jobId: JOB, getThread, getJob })).toBe('pending');
    });
    test('with no job, the chat alone is read', async () => {
        expect(await settleStoppedTurn({ ...base, jobId: null, getThread: async () => ({ messages: saved }), getJob: jest.fn() })).toBe('saved');
    });
});

describe('askStoppedSend', () => {
    test('closed counts only when it is the whole answer', async () => {
        expect(await askStoppedSend({ key: 'vx-k', closeSend: async () => ({ closed: true }) })).toEqual({ closed: true, job: null });
        expect(await askStoppedSend({ key: 'vx-k', closeSend: async () => ({ closed: true, job_id: JOB }) })).toEqual({ closed: false, job: null });
    });
    test('names the job the send made, in the shape the server makes', async () => {
        expect(await askStoppedSend({ key: 'vx-k', closeSend: async () => ({ closed: false, job_id: JOB, state: 'running' }) })).toEqual({ closed: false, job: JOB });
        expect(await askStoppedSend({ key: 'vx-k', closeSend: async () => ({ closed: false, job_id: 'x; drop' }) })).toEqual({ closed: false, job: null });
    });
    test('a refusal, a failure or a slow answer is no answer', async () => {
        expect(await askStoppedSend({ key: 'vx-k', closeSend: async () => { throw new Error('503'); } })).toEqual({ closed: false, job: null });
        expect(await askStoppedSend({ key: 'vx-k', closeSend: () => new Promise(() => undefined), limitMs: 5 })).toEqual({ closed: false, job: null });
        expect(await askStoppedSend({ key: null, closeSend: jest.fn() })).toEqual({ closed: false, job: null });
    });
});

describe('resolveStoppedSend', () => {
    test('stopped before start: the key is closed, nothing was charged, and no look is made', async () => {
        const getThread = jest.fn();
        const out = await resolveStoppedSend({ closeSend: async () => ({ closed: true }), getThread, getJob: jest.fn(), wait: noWait }, { key: 'vx-k', jobId: null, text: 'hi', knownIds: known });
        expect(out).toBe('nothing');
        expect(getThread).not.toHaveBeenCalled();
    });
    test('stopped before start but the send made a job: it is looked for by that job', async () => {
        const getJob = jest.fn(async () => ({ state: 'succeeded' }));
        const out = await resolveStoppedSend({ closeSend: async () => ({ closed: false, job_id: JOB }), getThread: jest.fn(), getJob, wait: noWait }, { key: 'vx-k', jobId: null, text: 'hi', knownIds: known });
        expect(out).toBe('saved');
        expect(getJob).toHaveBeenCalledWith(JOB);
    });
    test('after start the key is not asked about', async () => {
        const closeSend = jest.fn();
        await resolveStoppedSend({ closeSend, getThread: jest.fn(), getJob: async () => ({ state: 'succeeded' }), wait: noWait }, { key: 'vx-k', jobId: JOB, text: 'hi', knownIds: known });
        expect(closeSend).not.toHaveBeenCalled();
    });
});

describe('keys and notices', () => {
    test('a send key has the shape the close route accepts', () => {
        expect(SEND_KEY_RE.test(makeSendKey('0B1F6E5A-1C2D-4E3F-8A9B-0C1D2E3F4A5B'))).toBe(true);
        expect(SEND_KEY_RE.test('0b1f6e5a-1c2d-4e3f-8a9b-0c1d2e3f4a5b')).toBe(false);
    });
    test('every ending has words that say whether credits were used', () => {
        expect(stopNoticeKey('nothing')).toBe('chat.stop.nothing');
        expect(stopNoticeKey('pending')).toBe('chat.stop.pending');
    });
});
