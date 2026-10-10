// Preloaded with `node --import` by tests/providerBalancesRun.test.mjs. It
// stands in for the network so the real scripts/check-provider-balances.mjs
// can be run in a test. PROVIDER_BALANCE_STUB is JSON keyed by URL:
// { '<url>': { status, body } }; anything else is a 404.
const answers = JSON.parse(process.env.PROVIDER_BALANCE_STUB);

globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    // The key must travel in the header and nowhere else.
    const auth = init.headers && init.headers.Authorization;
    if (typeof auth !== 'string' || !/^(Key|Bearer) \S+$/.test(auth)) return new Response('', { status: 401 });
    const a = answers[url];
    if (!a) return new Response('', { status: 404 });
    return new Response(typeof a.body === 'string' ? a.body : JSON.stringify(a.body), { status: a.status ?? 200 });
};
