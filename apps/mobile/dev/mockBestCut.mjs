// Development stand-in for the Create Best Cut routes (ADR-0334). MOCK_BEST_CUT=on to enable, =silent for the no-speech path.
const PATH = '/api/v1/editor/speech-analyses';
const analysis = duration => {
    const words = (text, start) => text.split(' ').map((word, i) => ({ start: +(start + i * .35).toFixed(2), end: +(start + i * .35 + .3).toFixed(2), text: word }));
    const chunks = [...words('Welcome to my channel um today.', .6), ...words('Welcome to my channel today we cook pasta.', 4.2), ...words('Add the salt and stir the pot.', 8.4)].filter(c => c.end < duration);
    return { version: 1, assetId: 'mock', duration, provider: 'fal-scribe-v2', transcript: chunks.map(c => c.text).join(' '), language: 'en', chunks };
};
export function mockBestCut(method, path, search, body, state, mode) {
    if (!mode || !path.startsWith(PATH)) return null;
    if (path === `${PATH}/quote` && method === 'GET') return { status: 200, body: { credits: 3, max_seconds: 60, languages: ['en', 'es'], ...(search.includes('capability=best-cut') ? { source_types: ['job', 'upload'] } : {}) } };
    if (path === `${PATH}/preflight` && method === 'POST') return { status: 200, body: { clips: [{ cached: false, credits: 3 }] } };
    if (path.startsWith(`${PATH}/by-key/`)) return { status: 404, body: { error: 'request_not_found' } };
    if (path === PATH && method === 'POST') {
        if (body.expectedCredits !== 3) return { status: 409, body: { error: 'price_changed', credits: 3 } };
        if (mode === 'silent') return { status: 200, body: { id: 'mock-silent', status: 'completed', speech: false, refunded: true, credits: 3 } };
        state.balance -= 3;
        return { status: 200, body: { id: `mock-${body.idempotencyKey}`, status: 'completed', analysis: analysis(Math.min(60, body.duration)), credits: 3 } };
    }
    return null;
}
