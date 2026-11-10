import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Loads the real /s/[slug] page with the framework pieces a plain Node process
// cannot load stubbed, then makes the lookup RPC fail. A failed lookup must read
// as "not found": no thrown error, no view recorded.

const require = createRequire(import.meta.url);
const ts = require('typescript');
const React = require('react');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const abs = (rel) => path.join(ROOT, rel);
const NOT_FOUND = 'NEXT_NOT_FOUND';
const framework = {
    'next/navigation': { notFound() { throw new Error(NOT_FOUND); } },
};
const stubs = new Map([
    [abs('lib/i18n/server.js'), { getT: async () => ({ t: (key) => key }) }],
    [abs('app/veyrnox/_components/Main.js'), { Main: ({ children }) => React.createElement('main', null, children) }],
]);
const cache = new Map();

function resolveRelative(fromFile, id) {
    const base = path.resolve(path.dirname(fromFile), id);
    for (const candidate of [base, `${base}.js`, `${base}.mjs`, path.join(base, 'index.js')]) {
        try { readFileSync(candidate); return candidate; } catch { /* try the next */ }
    }
    throw new Error(`cannot resolve ${id} from ${fromFile}`);
}

function load(file) {
    if (stubs.has(file)) return stubs.get(file);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const code = ts.transpileModule(readFileSync(file, 'utf8'), {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText;
    new Function('require', 'module', 'exports', code)((id) => {
        if (framework[id]) return framework[id];
        return id.startsWith('.') ? load(resolveRelative(file, id)) : require(id);
    }, module, module.exports);
    return module.exports;
}

Object.assign(process.env, {
    SUPABASE_URL: 'https://db.test',
    SUPABASE_SERVICE_ROLE_KEY: 'test',
    PUBLISH_SMARTLINKS_ENABLED: 'true',
});
const page = load(abs('app/s/[slug]/page.js'));
const params = Promise.resolve({ slug: 'qa-missing-fixture' });

let calls = [];
const realFetch = globalThis.fetch;
const realError = console.error;
test.afterEach(() => { globalThis.fetch = realFetch; console.error = realError; });

function failLookup() {
    calls = [];
    console.error = () => {};
    globalThis.fetch = async (url) => {
        calls.push(new URL(url).pathname.split('/').pop());
        return new Response('boom', { status: 500 });
    };
}

test('a failed lookup gives the not-found title and the not-found page, and records no view', async () => {
    failLookup();
    assert.deepEqual(await page.generateMetadata({ params }), { title: 'smartlink.notFound' });
    await assert.rejects(page.default({ params }), { message: NOT_FOUND });
    assert.ok(calls.length > 0);
    assert.ok(calls.every((name) => name === 'read_social_smartlink_public'), calls.join(','));
});

test('the failure is logged by status only', async () => {
    failLookup();
    const logged = [];
    console.error = (...args) => logged.push(args);
    await page.generateMetadata({ params });
    assert.deepEqual(logged, [['[smartlink] read failed', 500]]);
});
