import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { AUTO_PRODUCT_DOCS, AUTO_PRODUCT_INVENTORY } from '../lib/generatedProductInventory.js';
import { buildVeyKnowledgeArtifact, renderVeyKnowledgeModule } from '../scripts/lib/vey-knowledge-source.mjs';

const root = process.cwd();

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
