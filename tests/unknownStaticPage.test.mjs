import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
const { isUnknownStaticPage } = await import('../lib/unknownStaticPage.js');
const { middleware } = await import('../middleware.js');

test('unknown and unpublished guide or template addresses are refused', () => {
    for (const p of ['/guides/nope', '/presets/nope', '/veyrnox/guides/nope', '/guides/credits%2F..', '/guides/%E0%A4%A', '/presets/CCTV-NIGHT', '/presets/cctv-night', '/veyrnox/presets/cctv-night',
        '/presets/product-hero-360', '/veyrnox/presets/product-hero-360']) {
        assert.equal(isUnknownStaticPage(p), true, p);
    }
    for (const p of ['/guides', '/guides/credits', '/guides/credits/', '/presets/a-moment-between-strangers', '/veyrnox/presets/a-moment-between-strangers',
        '/models/nope', '/', '/pricing', '/guides/credits/extra', '/app/library', undefined]) {
        assert.equal(isUnknownStaticPage(p), false, String(p));
    }
});

test('the middleware rewrites an unknown guide to a routeless path and keeps the CSP', async () => {
    const res = await middleware(new Request('https://veyrnox.test/guides/nope'));
    assert.match(res.headers.get('x-middleware-rewrite') || '', /\/_unknown-page$/);
    assert.match(res.headers.get('content-security-policy') || '', /default-src 'self'/);
    assert.equal(res.headers.get('cache-control'), 'private, no-store, max-age=0');
    const ok = await middleware(new Request('https://veyrnox.test/guides/credits'));
    assert.equal(ok.headers.get('x-middleware-rewrite'), null);
    assert.match(ok.headers.get('content-security-policy') || '', /default-src 'self'/);
});

test('generated preset lookup equals the full registry for both publication states and every candidate', async () => {
    const { ALL_TEMPLATES, LEGACY_TEMPLATE_IDS, REMOVED_PROMPT_GAP_TEMPLATE_IDS, templateById } = await import('../app/veyrnox/_lib/templates.js');
    const { SOURCE_TEMPLATES } = await import('../app/veyrnox/_lib/sourceTemplates.js');
    const { BROKEN_TEMPLATE_IDS } = await import('../app/veyrnox/_lib/brokenTemplateIds.js');
    const { IMAGE_TEMPLATES } = await import('../app/veyrnox/_lib/imageTemplates.js');
    const ids = new Set([...ALL_TEMPLATES, ...SOURCE_TEMPLATES, ...IMAGE_TEMPLATES].map(t => t.id).concat(LEGACY_TEMPLATE_IDS, REMOVED_PROMPT_GAP_TEMPLATE_IDS, BROKEN_TEMPLATE_IDS, ['no-such-template', '%', 'UPPERCASE']));
    const previous = process.env.IMAGE_TEMPLATES_ENABLED;
    try {
        for (const flag of ['true', 'false']) {
            process.env.IMAGE_TEMPLATES_ENABLED = flag;
            for (const id of ids) for (const prefix of ['/presets/', '/veyrnox/presets/']) for (const suffix of ['', '/']) {
                assert.equal(isUnknownStaticPage(prefix + id + suffix), !templateById(id), `${flag}: ${prefix}${id}${suffix}`);
            }
        }
    } finally {
        if (previous === undefined) delete process.env.IMAGE_TEMPLATES_ENABLED;
        else process.env.IMAGE_TEMPLATES_ENABLED = previous;
    }
});

test('middleware cannot import prompt records and stays below 400,000 source bytes', async () => {
    const { readFileSync, existsSync } = await import('node:fs');
    const { resolve, dirname, relative } = await import('node:path');
    const { default: ts } = await import('typescript');
    const seen = new Set();
    let bytes = 0;
    function walk(path) {
        if (seen.has(path)) return;
        seen.add(path);
        const name = relative(process.cwd(), path);
        assert.doesNotMatch(name, /(?:^|\/)(?:templates|sourceTemplates|sourcePromptRecords|sourcePromptAudit|imageTemplates|showcase)\.js$|Records\.js$/);
        const source = readFileSync(path, 'utf8'); bytes += Buffer.byteLength(source);
        if (path.endsWith('.json')) return;
        const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
        for (const statement of parsed.statements) {
            if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
            const specifier = statement.moduleSpecifier?.text;
            if (!specifier?.startsWith('.')) continue;
            const base = resolve(dirname(path), specifier);
            const target = [base, base + '.js', base + '.mjs', base + '.json', resolve(base, 'index.js')].find(existsSync);
            assert.ok(target, `${name}: ${specifier}`); walk(target);
        }
    }
    walk(resolve('middleware.js'));
    assert.ok(bytes < 400000, `${seen.size} modules / ${bytes} bytes`);
    console.log(`Middleware static graph: ${seen.size} modules / ${bytes} bytes`);
});
