import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { AUTO_PRODUCT_DOCS, AUTO_PRODUCT_INVENTORY } from '../lib/generatedProductInventory.js';
import { buildVeyKnowledgeArtifact, renderVeyKnowledgeModule } from '../scripts/lib/vey-knowledge-source.mjs';

const root = process.cwd();
const retiredFilmStudioKnowledge = {
    controls: new Set(['Import studio JSON', 'Prepare 16:9 master']),
    links: new Set(['/legal/aup']),
    descriptions: new Set([
        'Your current film is still here. Export it first if you want to keep a separate copy.',
        'The studio export contains your project documents and this folder structure.',
        'Create an exact 16:9 master at 1920×1080. The picture fills the frame with a centre crop, without stretching. The shot card sets the length. Export is free. Masters prepared from a Library take can be saved directly to your Library.',
        'To save directly to Library, log a Library take ID and prepare its master without choosing a local file.',
        'Saving is free. The video stays in your Library until its source take expires, up to 90 days.',
    ]),
};
const retiredOddlingsKnowledge = {
    descriptions: new Set([
        'Local moodboard preview; describe what to borrow below.',
    ]),
};

test('phase B retains every app route knowledge item from origin/main', async () => {
    const baseline = JSON.parse(await readFile(path.join(root, 'tests/fixtures/app-knowledge-main.json'), 'utf8'));
    assert.equal(baseline.routes.length, 32);
    const words = value => value.toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    for (const entry of baseline.routes) {
        const current = AUTO_PRODUCT_INVENTORY.find(row => row.route === entry.route);
        assert.ok(current, entry.route);
        for (const [field, values] of Object.entries(entry)) {
            if (field === 'route') continue;
            const normal = ['links', 'targets'].includes(field) ? value => value : words;
            const actual = new Set(current[field].map(normal));
            for (const value of values) {
                // Film export/import and verified-master creation were retired
                // deliberately. Keep each removed item explicit so later
                // knowledge loss still requires a conscious decision.
                if (entry.route === '/app/film-studio' && retiredFilmStudioKnowledge[field]?.has(value)) continue;
                // Oddlings now uploads a source image for the recommended edit
                // pipeline instead of treating it as a local-only moodboard.
                if (entry.route === '/app/oddlings' && retiredOddlingsKnowledge[field]?.has(value)) continue;
                assert.ok(actual.has(normal(value)), `${entry.route} ${field}: ${value}`);
            }
        }
    }
});

test('generated Vey knowledge matches the current product source', async () => {
    const artifact = await buildVeyKnowledgeArtifact(root);
    const generated = await readFile(path.join(root, 'lib/generatedProductInventory.js'), 'utf8');
    assert.equal(generated, renderVeyKnowledgeModule(artifact), 'run npm run sync:vey-knowledge');
});

test('automatic knowledge inventories product routes and approved documentation', () => {
    const routes = new Set(AUTO_PRODUCT_INVENTORY.map((entry) => entry.route));
    for (const route of ['/app', '/app/create', '/app/chat', '/app/film-studio', '/app/library', '/app/credits', '/app/publish', '/models', '/presets', '/tools', '/mcp', '/social-cinema']) {
        assert.ok(routes.has(route), `missing generated route ${route}`);
    }
    assert.ok(AUTO_PRODUCT_INVENTORY.every((entry) => entry.title && entry.sourceHash));
    assert.ok(AUTO_PRODUCT_DOCS.some((entry) => entry.source === 'docs/product/film-studio.md'));
    assert.ok(AUTO_PRODUCT_DOCS.every((entry) => entry.text && entry.sourceHash));
});

test('ancestor layout notices retain knowledge after selectors switch to stable hooks', () => {
    for (const route of ['/legal/aup', '/m', '/social-cinema', '/social/review/[token]']) {
        const entry = AUTO_PRODUCT_INVENTORY.find(value => value.route === route);
        assert.ok(entry.controls.includes('Browser storage notice'), route);
        assert.ok(entry.controls.includes('Got it'), route);
    }
});

test('every app page is represented exactly once, including legal and callback routes', async () => {
    async function pages(directory) {
        const entries = await readdir(directory, { withFileTypes: true });
        return (await Promise.all(entries.map((entry) => entry.isDirectory()
            ? pages(path.join(directory, entry.name))
            : /^page\.(js|jsx|mjs|tsx)$/.test(entry.name) ? [path.join(directory, entry.name)] : []))).flat();
    }
    const sources = (await pages(path.join(root, 'app'))).map((file) => path.relative(root, file)).sort();
    assert.deepEqual(AUTO_PRODUCT_INVENTORY.map((entry) => entry.source).sort(), sources);
    assert.equal(new Set(AUTO_PRODUCT_INVENTORY.map((entry) => entry.route)).size, sources.length);
    for (const route of ['/legal/privacy', '/auth/callback', '/s/[slug]', '/social/review/[token]', '/social/team/invite/[token]', '/design-system']) {
        assert.ok(AUTO_PRODUCT_INVENTORY.some((entry) => entry.route === route), route);
    }
});

test('static translation resolution preserves English copy, rich labels and literal slots without executing code', async () => {
    const { resolveI18nSource } = await import('../scripts/lib/vey-knowledge-i18n.mjs');
    const messages = { title: 'Creator workspace', detail: 'Up to {count} minutes.', linked: 'Read {policy}.', 'label.Start frame': 'Start frame' };
    const source = `<h1>{t('title')}</h1><p>{t('detail', { count: 10 })}</p><label>{t.label('Start frame')}</label><p>{rich(t('linked'), { policy: <a href="/legal/privacy">Privacy</a> })}</p><a href={localizedHref('/m')}>Mobile</a>`;
    const resolved = resolveI18nSource(source, messages);
    assert.ok(resolved.includes('<h1>Creator workspace</h1>'));
    assert.ok(resolved.includes('<p>Up to 10 minutes.</p>'));
    assert.ok(resolved.includes('<label>Start frame</label>'));
    assert.ok(resolved.includes('<p>Read Privacy.</p>'));
    assert.ok(resolved.includes('href="/m"'));
    const linked = `<p>{rich(t('linked'), { policy: <a href={localize('/legal/privacy')}>Privacy</a> })}</p>`;
    assert.ok(resolveI18nSource(linked, messages, { attributesOnly: true }).includes('href="/legal/privacy"'));
    const dynamic = `<p>{t(serverKey)}</p><p>{t('absent')}</p><p>{dangerous()}</p>`;
    assert.equal(resolveI18nSource(dynamic, messages), dynamic);
});

test('all main route knowledge survives localization except the retired unknown-series fallback', async () => {
    const baseline = JSON.parse(await readFile(path.join(root, 'tests/fixtures/public-site-knowledge-main.json'), 'utf8'));
    // Case, typographic punctuation and link-adjacent spaces are presentation,
    // not facts. Links and assistant target identifiers must remain exact.
    const words = value => value.toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    for (const [route, fields] of Object.entries(baseline.routes)) {
        const current = AUTO_PRODUCT_INVENTORY.find(entry => entry.route === route);
        assert.ok(current, route);
        for (const [field, indices] of Object.entries(fields)) {
            const normal = ['links', 'targets'].includes(field) ? value => value : words;
            const actual = new Set(current[field].map(normal));
            for (const index of indices) {
                const expected = baseline.texts[index];
                // The accepted phase-A correction calls notFound() for unknown
                // series. Do not restore nonexistent HTTP-200 fallback copy.
                if (route === '/social-cinema/series/[slug]' && field === 'descriptions' && expected === 'This series is not available.') continue;
                if (route === '/app/film-studio' && retiredFilmStudioKnowledge[field]?.has(expected)) continue;
                if (route === '/app/oddlings' && retiredOddlingsKnowledge[field]?.has(expected)) continue;
                assert.ok(actual.has(normal(expected)), `${route} ${field}: ${expected}`);
            }
        }
    }
    const series = await readFile(path.join(root, 'app/veyrnox/social-cinema/series/[slug]/page.js'), 'utf8');
    assert.match(series, /if \(!series\) notFound\(\)/);
});
