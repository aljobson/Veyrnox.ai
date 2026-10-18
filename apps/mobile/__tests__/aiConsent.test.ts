import { ApiError } from '../src/lib/api';
import { AI_CONSENT_TEXT, createConsentGate, sendsContent, type ConsentStorage } from '../src/lib/aiConsent';

const memory = (): ConsentStorage & { map: Map<string, string> } => {
    const map = new Map<string, string>();
    return { map, get: async (k) => map.get(k) ?? null, set: async (k, v) => void map.set(k, v) };
};

describe('which calls carry content', () => {
    test('POSTs that reach a provider', () => {
        expect(sendsContent('/api/v1/generations', 'POST')).toBe(true);
        expect(sendsContent('/api/v1/uploads', 'post')).toBe(true);
        expect(sendsContent('/api/v1/montage/plan', 'POST')).toBe(true);
        expect(sendsContent('/api/v1/chat/threads/abc-123/messages', 'POST')).toBe(true);
    });
    test('reads and account calls do not', () => {
        expect(sendsContent('/api/v1/generations', 'GET')).toBe(false);
        expect(sendsContent('/api/v1/balance', 'GET')).toBe(false);
        expect(sendsContent('/api/v1/chat/threads', 'POST')).toBe(false);
        expect(sendsContent('/api/v1/jobs/1', 'DELETE')).toBe(false);
        expect(sendsContent('/api/v1/reports', 'POST')).toBe(false);
        expect(sendsContent('/api/v1/chat/threads/a/messages-evil', 'POST')).toBe(false);
    });
});

describe('the gate', () => {
    test('asks once, stores the answer per account, and lets the call through', async () => {
        const storage = memory();
        const gate = createConsentGate(storage);
        const ask = jest.fn(async () => true);
        gate.setUser('user-1');
        gate.setPrompter(ask);
        await gate.ensure('/api/v1/generations', 'POST');
        await gate.ensure('/api/v1/uploads', 'POST');
        expect(ask).toHaveBeenCalledTimes(1);
        expect([...storage.map.keys()].some((k) => k.endsWith('.user-1'))).toBe(true);
        expect(await gate.hasAgreed()).toBe(true);
        gate.setUser('user-2');
        expect(await gate.hasAgreed()).toBe(false);
        await gate.ensure('/api/v1/generations', 'POST');
        expect(ask).toHaveBeenCalledTimes(2);
    });

    test('Not now stops the call and is asked again next time', async () => {
        const gate = createConsentGate(memory());
        const ask = jest.fn(async () => false);
        gate.setUser('u');
        gate.setPrompter(ask);
        await expect(gate.ensure('/api/v1/generations', 'POST')).rejects.toMatchObject({ code: 'consent_declined' });
        await expect(gate.ensure('/api/v1/generations', 'POST')).rejects.toBeInstanceOf(ApiError);
        expect(ask).toHaveBeenCalledTimes(2);
    });

    test('calls that carry no content never ask', async () => {
        const gate = createConsentGate(memory());
        const ask = jest.fn(async () => true);
        gate.setUser('u');
        gate.setPrompter(ask);
        await gate.ensure('/api/v1/balance', 'GET');
        expect(ask).not.toHaveBeenCalled();
    });

    test('two sends at once share one question', async () => {
        const gate = createConsentGate(memory());
        let answer: (v: boolean) => void = () => undefined;
        const ask = jest.fn(() => new Promise<boolean>((r) => (answer = r)));
        gate.setUser('u');
        gate.setPrompter(ask);
        const a = gate.ensure('/api/v1/generations', 'POST');
        const b = gate.ensure('/api/v1/uploads', 'POST');
        for (let i = 0; i < 20 && ask.mock.calls.length === 0; i++) await Promise.resolve();
        answer(true);
        await Promise.all([a, b]);
        expect(ask).toHaveBeenCalledTimes(1);
    });

    test('with no account or no screen to ask on, it refuses rather than sends', async () => {
        const gate = createConsentGate(memory());
        await expect(gate.ensure('/api/v1/generations', 'POST')).rejects.toMatchObject({ code: 'consent_declined' });
        gate.setUser('u');
        await expect(gate.ensure('/api/v1/generations', 'POST')).rejects.toMatchObject({ code: 'consent_declined' });
    });

    test('a storage failure re-asks instead of sending silently', async () => {
        const gate = createConsentGate({ get: async () => { throw new Error('x'); }, set: async () => { throw new Error('x'); } });
        const ask = jest.fn(async () => true);
        gate.setUser('u');
        gate.setPrompter(ask);
        await gate.ensure('/api/v1/generations', 'POST');
        await gate.ensure('/api/v1/generations', 'POST');
        expect(ask).toHaveBeenCalledTimes(2);
    });
});

test('the wording names third-party AI providers and offers Not now', () => {
    expect(AI_CONSENT_TEXT.body).toMatch(/third-party AI providers/);
    expect(AI_CONSENT_TEXT.decline).toBe('Not now');
});
