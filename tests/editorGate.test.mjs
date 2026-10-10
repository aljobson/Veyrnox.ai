import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { outputSize } from '../app/veyrnox/_lib/editorExport.mjs';
import { contentSecurityPolicy } from '../lib/contentSecurityPolicy.mjs';

const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

// ADR-0080: the editor has no server API, so the server flag closes the route itself and a per-browser switch hides it while staged.
test('the editor flag is off in production and in the staging block of the repo', () => {
    const text = read('wrangler.jsonc');
    const hits = [...text.matchAll(/"EDITOR_TIMELINE_ENABLED":\s*"(\w+)"/g)].map(m => m[1]);
    assert.deepEqual(hits, ['false', 'false'], 'one in each block, both off');
    assert.ok(text.indexOf('"EDITOR_TIMELINE_ENABLED"') < text.indexOf('"env"'), 'the first one is the production block');
});

test('the route is closed by the flag and the page needs the browser switch', () => {
    const layout = read('app/veyrnox/app/editor/layout.js');
    assert.match(layout, /EDITOR_TIMELINE_ENABLED !== 'true'\) notFound\(\)/);
    assert.match(layout, /robots: \{ index: false/);
    assert.match(read('app/veyrnox/_lib/useEditorPreview.js'), /veyrnox_editor_timeline/);
    assert.doesNotMatch(read('app/veyrnox/_components/NavBar.js'), /editor/i, 'no nav link while staged');
});

test('the editor adds no network call of its own and no engine the policy forbids', () => {
    const files = ['app/veyrnox/app/editor/page.js', 'app/veyrnox/_lib/editorExport.mjs', 'app/veyrnox/_lib/editorPreview.mjs', 'app/veyrnox/_lib/editorMedia.mjs'];
    for (const f of files) assert.doesNotMatch(read(f), /\bWebAssembly\b|wasm|eval\(|new Function|dangerouslySetInnerHTML/, f);
    const csp = contentSecurityPolicy('AAAAAAAAAAAAAAAAAAAAAA==', false, 'production');
    assert.doesNotMatch(csp, /wasm-unsafe-eval|unsafe-eval/, 'the production policy still forbids runtime code and WebAssembly');
    // The page itself never posts anything. Server calls live in two places: the Library reads (editorLibrary.mjs) and the
    // project bar (slice 3), which may only speak to the projects and workspaces routes, behind the projects preview switch.
    assert.doesNotMatch(read('app/veyrnox/app/editor/page.js'), /method:\s*['"](POST|PUT|PATCH|DELETE)/);
    const bar = read('app/veyrnox/_components/editor/ProjectBar.js');
    for (const m of bar.matchAll(/gatewayFetch\((?:`|')([^`']*)/g)) assert.match(m[1], /^(\/(projects|workspaces)|\$\{endpoint\})/, m[1]);
    assert.match(bar, /const endpoint = projectId \? `\/projects\//);
    assert.match(bar, /useProjectsPreview\(\)/);
    assert.match(bar, /if \(!enabled\) return null/);
});

test('output size keeps the first clip shape, even and within 1920 wide', () => {
    assert.deepEqual(outputSize(1920, 1080, 720), { width: 1280, height: 720 });
    assert.deepEqual(outputSize(1080, 1920, 1080), { width: 608, height: 1080 });
    const wide = outputSize(4000, 1000, 1080);
    assert.ok(wide.width <= 1920 && wide.width % 2 === 0 && wide.height % 2 === 0);
    assert.deepEqual(outputSize(0, 0, 999), { width: 1280, height: 720 });
});
