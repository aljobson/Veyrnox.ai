// Preloaded with `node --import` by tests/falCatalogWatchRun.test.mjs. It
// stands in for the network so the real scripts/check-fal-catalog.mjs can be
// run in a test: the catalog read answers with `rows`, a fal model page with
// `pages[endpoint]`, and anything else is a 404.
// FAL_WATCH_STUB is JSON: { rows: [...], pages: { '<endpoint>': '<html>' } }.
const { rows, pages } = JSON.parse(process.env.FAL_WATCH_STUB);

globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/rest/v1/rpc/catalog_watch')) return new Response(JSON.stringify(rows));
    const html = pages[url.replace('https://fal.ai/models/', '')];
    return html === undefined ? new Response('', { status: 404 }) : new Response(html);
};
