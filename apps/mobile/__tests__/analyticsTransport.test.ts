import { createTransportToken } from '../src/lib/analytics/transport';

test('tagged malformed headers are dropped; untagged calls pass through unchanged', async () => {
    const original = globalThis.fetch;
    const network = jest.fn(async () => new Response('{}', { status: 200 }));
    globalThis.fetch = network;
    try {
        const gate = createTransportToken('https://veyrnox.ai/ingest');
        const invalid = { headers: { ...gate.headers, 'invalid\nname': 'value' } };
        await expect(globalThis.fetch('https://veyrnox.ai/ingest/batch/', invalid)).resolves.toHaveProperty('status', 200);
        expect(network).not.toHaveBeenCalled();
        const unrelated = { headers: { 'invalid\nname': 'value' } };
        await globalThis.fetch('https://veyrnox.ai/api/test', unrelated);
        expect(network).toHaveBeenLastCalledWith('https://veyrnox.ai/api/test', unrelated);
        network.mockClear();
        for (const headers of [gate.headers, new Headers(gate.headers), Object.entries(gate.headers)]) {
            await globalThis.fetch('https://veyrnox.ai/ingest/batch/', { headers });
        }
        expect(network).toHaveBeenCalledTimes(3);
        network.mockClear();
        for (const path of ['flags', 'decide', 'config']) {
            await globalThis.fetch(`https://veyrnox.ai/ingest/${path}/`, { headers: gate.headers });
        }
        gate.revoke();
        await globalThis.fetch('https://veyrnox.ai/ingest/batch/', { headers: gate.headers });
        expect(network).not.toHaveBeenCalled();
    } finally { globalThis.fetch = original; }
});
