// Preloaded with `node --import` by tests/check-worker-secrets.test.mjs. It
// stands in for the Cloudflare API so the real scripts/check-worker-secrets.mjs
// can be run in a test: one live deployment whose one version binds `names`
// as secrets. WORKER_SECRETS_STUB is JSON: { names: [...], version?: <status
// for every read of the version>, versionFirst?: <status for its first read> }.
const stub = JSON.parse(process.env.WORKER_SECRETS_STUB);
const answer = (status, body) => new Response(JSON.stringify(body), { status });
let versionReads = 0;

globalThis.fetch = async (input, init) => {
    if (init?.headers?.Authorization !== `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`) return answer(401, { success: false });
    if (String(input).endsWith('/deployments')) {
        return answer(200, { success: true, result: { deployments: [{ created_on: '2026-10-09', versions: [{ version_id: 'live', percentage: 100 }] }] } });
    }
    const status = (versionReads++ === 0 ? stub.versionFirst : undefined) ?? stub.version ?? 200;
    if (status !== 200) return answer(status, { success: false, errors: [{ message: 'private value' }] });
    return answer(200, { success: true, result: { resources: { bindings: [
        ...stub.names.map((name) => ({ type: 'secret_text', name })), { type: 'plain_text', name: 'APP_ENV', text: 'private value' }] } } });
};
