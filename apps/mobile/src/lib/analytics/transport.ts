// SDK 4.81 has no fetch option. Its public transport uses global fetch. Tag only
// our SDK requests; strip the private tag before delegating to the real transport.
const HEADER = 'x-veyrnox-analytics-instance';
const tokens = new Map<string, { active: boolean; endpoint: string }>();
let installed = false;
let serial = 0;
const discarded = () => Promise.resolve(new Response('{}', { status: 200 }));
export function createTransportToken(host: string) {
    if (!installed) {
        const transport = globalThis.fetch;
        globalThis.fetch = (input, init) => {
            const raw = init?.headers;
            // Inspect only the private tag; unrelated calls retain their original
            // inputs and the underlying transport's validation behavior.
            const id = raw instanceof Headers ? raw.get(HEADER)
                : (Array.isArray(raw) ? raw : Object.entries(raw ?? {}))
                    .find(entry => Array.isArray(entry) && String(entry[0]).toLowerCase() === HEADER)?.[1];
            if (!id) return transport(input, init);
            let headers: Headers;
            try { headers = new Headers(raw); }
            catch { return discarded(); }
            headers.delete(HEADER);
            const token = tokens.get(id);
            if (!token?.active || String(input) !== token.endpoint) return discarded();
            return transport(input, { ...init, headers });
        };
        installed = true;
    }
    const id = `${Date.now()}-${++serial}-${Math.random()}`;
    const token = { active: true, endpoint: `${host}/batch/` };
    tokens.set(id, token);
    return { token, headers: { [HEADER]: id }, revoke: () => { token.active = false; tokens.delete(id); } };
}
