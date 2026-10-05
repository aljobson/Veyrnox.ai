import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { templateStartId } from '../lib/templateStart.js';
import { PRESETS } from '../app/veyrnox/_lib/templates.js';
import { modelIdForName } from '../app/veyrnox/_lib/tokens.js';

register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service', KIE_API_KEY: 'k', KIE_WEBHOOK_HMAC_KEY: 'h', PUBLIC_HOST: 'https://veyrnox.test' });
const popular = await import('../app/api/popular-templates/route.js');
const generations = await import('../app/api/v1/generations/route.js');
const gallery = readFileSync(new URL('../app/veyrnox/_components/PresetGallery.js', import.meta.url), 'utf8');
const create = readFileSync(new URL('../app/veyrnox/app/create/page.js', import.meta.url), 'utf8');

const AUTH = '11111111-1111-4111-8111-111111111111';
const JOB = '22222222-2222-4222-8222-222222222222';
const withModel = PRESETS.find((p) => modelIdForName(p.model));
const mid = modelIdForName(withModel.model);

test('a template id is believed only when it is real and belongs to the model in use', () => {
    assert.equal(templateStartId(withModel.id, mid), withModel.id);
    assert.equal(templateStartId(withModel.id, 'some-other-model'), null, 'wrong model: cannot be attached to an unrelated generation');
    for (const bad of [undefined, null, 42, {}, [], '', 'no-such-template', 'Bad Id', '../x', 'a'.repeat(80), `${withModel.id}; drop`]) {
        assert.equal(templateStartId(bad, mid), null, JSON.stringify(bad));
    }
    assert.equal(templateStartId(withModel.id, undefined), null);
});

function network({ model, rpcs = {} } = {}) {
    const calls = []; const real = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
        const u = new URL(String(url));
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
        calls.push({ path: u.pathname, body });
        if (u.pathname.includes('/rpc/')) {
            const name = u.pathname.split('/rpc/')[1];
            if (name in rpcs) { const r = rpcs[name]; if (r instanceof Error) throw r; return Response.json(r); }
            if (name === 'ledger_debit') return Response.json({ ok: true, job_id: JOB, idempotent: false, balance_after: 50 });
            return Response.json({ ok: true });
        }
        if (u.pathname === '/rest/v1/model_catalog') return Response.json([model]);
        if (u.pathname === '/rest/v1/users') return Response.json([{ id: AUTH }]);
        if (u.hostname === 'api.kie.ai') return Response.json({ code: 200, data: { taskId: 't1' } });
        throw new Error(`Unexpected request: ${u.hostname}${u.pathname}`);
    };
    return { calls, restore: () => { globalThis.fetch = real; } };
}
// The fake catalog row takes the id of a model a real template is wired to, so the real template/model pairing is what is tested.
const kieModel = { id: mid, provider: 'kie', provider_endpoint: 'market:flux-2/pro-text-to-image', modality: 'text-to-image', credits_5s: 2, active: true, gated_flag: false };
const post = (extra) => generations.POST(new Request('https://veyrnox.test/api/v1/generations', {
    method: 'POST', headers: { 'x-veyrnox-auth-id': AUTH, 'content-type': 'application/json' },
    body: JSON.stringify({ model_id: kieModel.id, idempotency_key: 'preset-test-0001', inputs: { prompt: 'A teapot' }, ...extra }),
}));
const forThisModel = withModel;

test('the route records a valid template on the job but never sends it to a provider', async () => {
    const net = network({ model: kieModel });
    try {
        const res = await post({ preset: forThisModel.id });
        assert.equal(res.status, 200);
        const debit = net.calls.find((c) => c.path.endsWith('/rpc/ledger_debit')).body;
        assert.equal(debit.p_inputs.preset_id, forThisModel.id);
        const sent = net.calls.filter((c) => c.path.includes('createTask'));
        assert.ok(sent.length > 0 && sent.every((c) => !JSON.stringify(c.body).includes('preset')), 'the provider never sees it');
    } finally { net.restore(); }
});

test('a bad, unknown or mismatched template is ignored: the generation still runs and nothing is recorded', async () => {
    const otherModel = PRESETS.find((p) => modelIdForName(p.model) && modelIdForName(p.model) !== mid);
    for (const preset of ['no-such-template', 42, '../x', otherModel.id]) { // the last is a real template, but for a different model
        const net = network({ model: kieModel });
        try {
            const res = await post({ preset });
            assert.equal(res.status, 200, JSON.stringify(preset));
            const debit = net.calls.find((c) => c.path.endsWith('/rpc/ledger_debit')).body;
            assert.ok(!('preset_id' in debit.p_inputs), JSON.stringify(preset));
        } finally { net.restore(); }
    }
});

test('the ranking route returns well-formed ids only, caches publicly, and fails closed', async () => {
    let net = network({ rpcs: { popular_templates: ['neon-alley', 'Bad Id!', 7, 'anime-hero', '../x'] } });
    try {
        const res = await popular.GET();
        assert.deepEqual(await res.json(), { templates: ['neon-alley', 'anime-hero'] });
        assert.match(res.headers.get('cache-control'), /public/);
    } finally { net.restore(); }
    net = network({ rpcs: { popular_templates: { not: 'a list' } } });
    try { assert.deepEqual(await (await popular.GET()).json(), { templates: [] }); } finally { net.restore(); }
    net = network({ rpcs: { popular_templates: new Error('down') } });
    const errors = console.error; console.error = () => {};
    try {
        const res = await popular.GET();
        assert.equal(res.status, 502);
        assert.deepEqual(await res.json(), { error: 'popular_unavailable' });
        assert.equal(res.headers.get('cache-control'), 'no-store');
    } finally { console.error = errors; net.restore(); }
});

test('the gallery labels every category, shows Popular only when something ranked, and in rank order', () => {
    for (const c of ['CARTOONS', 'MOVIES', 'FANTASY', 'REALISTIC', 'POPULAR']) assert.match(gallery, new RegExp(`${c}: '`), `${c} has a label`);
    assert.match(gallery, /const categories = popular\.length \? \['ALL', 'NEW', 'POPULAR', \.\.\.PRESET_CATEGORIES\.slice\(2\)\] : PRESET_CATEGORIES;/);
    assert.match(gallery, /const list = cat === 'POPULAR' \? popular : templatesIn\(cat\);/);
});

test('the studio sends the template only while its own model is selected', () => {
    assert.match(create, /preset: templateStartId\(presetParam, modelId\) \|\| undefined,/);
    assert.match(create, /setPresetParam\(params\.get\('preset'\)\)/);
});
