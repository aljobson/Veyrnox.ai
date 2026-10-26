import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import React from 'react';
import ts from 'typescript';
import * as uploads from '../app/veyrnox/_lib/editorServerRenderUploads.mjs';
import * as client from '../app/veyrnox/_lib/editorServerRenderClient.mjs';

const require = createRequire(import.meta.url);
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const actor = '11111111-1111-4111-8111-111111111111';
const walk = node => Array.isArray(node) ? node.flatMap(walk) : React.isValidElement(node) ? [node, ...walk(node.props.children)] : [];
// Same transpiled-component/hook approach as authenticatedSmartLinkState.test.mjs.
function fixture(file, exported, mocks = {}, initialStates = {}) {
    let cursor = 0, stateIndex = 0;
    const slots = [], setters = [], effects = [], timers = new Map();
    let timerId = 0;
    const hooks = {
        useState(initial) {
            const index = cursor++, at = stateIndex++;
            if (!(index in slots)) slots[index] = Object.hasOwn(initialStates, at) ? initialStates[at] : typeof initial === 'function' ? initial() : initial;
            setters[at] = value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; };
            return [slots[index], setters[at]];
        },
        useRef(current) { const index = cursor++; return slots[index] ||= { current }; },
        useMemo(fn, deps) {
            const index = cursor++, previous = slots[index];
            if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) slots[index] = { deps, value: fn() };
            return slots[index].value;
        },
        useCallback(fn, deps) { return hooks.useMemo(() => fn, deps); },
        useEffect(fn, deps) {
            const index = cursor++, previous = slots[index];
            if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
                previous?.cleanup?.(); slots[index] = { deps };
                effects.push(() => { slots[index].cleanup = fn(); });
            }
        },
    };
    const timer = fn => { timers.set(++timerId, fn); return timerId; };
    const clear = id => timers.delete(id);
    const browserDocument = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
    const stubs = {
        react: hooks,
        '../../_lib/editorServerRenderUploads.mjs': uploads,
        '../../../../components/I18nProvider': { useI18n: () => ({ t: key => key, locale: 'en' }) },
        '../../../../lib/i18n/locales.mjs': { localeTag: () => 'en' },
        '../../../lib/authClient': { getStoredUserId: () => actor, onSessionChange: () => () => {} },
        '../Button': { Button: 'button' },
        ...mocks,
    };
    const output = { exports: {} };
    const code = ts.transpileModule(`${read(file)}\nexport { ${exported} };`, {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    new Function('require', 'exports', 'window', 'document', 'setTimeout', 'clearTimeout', code)(
        id => id === 'react/jsx-runtime' ? require(id) : stubs[id] || {}, output.exports,
        { location: { search: '' } }, browserDocument, timer, clear);
    return {
        setters, timers,
        render(props) { cursor = 0; stateIndex = 0; const tree = output.exports[exported](props); while (effects.length) effects.shift()(); return tree; },
        async tick() { const [id, fn] = timers.entries().next().value; timers.delete(id); await fn(); },
        dispose() { for (const slot of slots) slot?.cleanup?.(); },
    };
}

for (const eligible of [undefined, false, true]) test(`project context document subscription is gated (${eligible})`, () => {
    const first = { project_id: 'project', schema_version: 2 }, next = { ...first, brief: 'Changed' };
    const context = [];
    const f = fixture('app/veyrnox/_components/editor/ProjectBar.js', 'ProjectSessionBar', {
        '../ProjectsFlag': { useProjectsEnabled: () => false },
        './MultitrackFlag': { useMultitrackEnabled: () => true },
        '../../../../lib/projectDocument.js': { equalProjectDocuments: () => true },
        '../../_lib/editorProject.mjs': { documentForTimeline: doc => doc },
    }, { 3: first });
    const props = { tl: {}, blobs: { current: new Map() }, onContext: value => context.push(value), serverRenderEligible: eligible };
    f.render(props);
    assert.equal(context.length, 1);
    const original = { id: null, workspaceId: null, revision: 0, dirty: false, busy: false, error: false, savedAt: null };
    assert.deepEqual(context[0], eligible ? { ...original, document: first, actor } : original);
    f.setters[3](next); f.render(props);
    assert.equal(context.length, eligible ? 2 : 1, 'doc-only changes must not re-run setProjectContext while off');
    if (eligible) assert.equal(context[1].document, next);
    else { assert.equal(Object.hasOwn(context[0], 'document'), false); assert.equal(Object.hasOwn(context[0], 'actor'), false); }
    f.dispose();
});

test('workspace passes the admission flag gate to ProjectBar', () => {
    assert.match(read('app/veyrnox/_components/editor/MultitrackWorkspace.js'), /<ProjectBar compact serverRenderEligible=\{serverRender !== 'off'\}/);
});

for (const status of [403, 404, 500]) test(`poll failure ${status} stops, survives reopening, and retries only status with cancel available`, async () => {
    const calls = [];
    let fail = true;
    let state = { actor, job: client.renderStatus({ job_id: 'job', state: 'SUBMITTED', credits: 2 }) };
    const mocks = {
        '../../_lib/editorServerRenderClient.mjs': client,
        '../../_lib/editorDelivery.mjs': { accountBoundCall: call => call },
        '../../_lib/gateway': {
            gatewayFetch: async (path, init = {}) => { calls.push({ path, method: init.method || 'GET' }); if (fail) throw { status }; return { job_id: 'job', state: 'running', credits: 2 }; },
            makeIdempotencyKey: () => assert.fail('checking status must not create a paid attempt'), notifyBalanceChanged() {},
        },
        '../ConfirmDialog': { ConfirmDialog: 'confirm-dialog' },
    };
    const create = () => fixture('app/veyrnox/_components/editor/ServerRenderPanel.js', 'RenderSession', mocks);
    let f = create();
    const props = { actor, timeline: {}, height: 720, label: 'Name', onState: value => { state = typeof value === 'function' ? value(state) : value; } };
    const render = () => f.render({ ...props, state });
    let tree = render();
    const limit = status === 500 ? 5 : 1;
    for (let n = 0; n < limit; n++) { assert.equal(f.timers.size, 1); await f.tick(); tree = render(); }
    assert.equal(calls.length, limit);
    assert.equal(f.timers.size, 0);
    assert.equal(state.job.phase, 'rendering', 'status failure must not claim the render failed');
    assert.equal(state.statusUnavailable, true);
    assert.ok(walk(tree).some(node => node.type === 'p' && node.props.children === 'app.editor.server.statusUnavailable'));
    assert.equal(walk(tree).filter(node => node.type === 'progress').length, 0);
    const cancel = walk(tree).find(node => node.type === 'button' && node.props.children === 'app.editor.server.cancel');
    assert.equal(cancel.props.disabled, false);
    cancel.props.onClick(); tree = render();
    assert.ok(walk(tree).some(node => node.type === 'confirm-dialog' && node.props.onConfirm));
    f.dispose(); f = create(); tree = render();
    assert.equal(f.timers.size, 0, 'reopening must retain stopped state');
    fail = false;
    walk(tree).find(node => node.type === 'button' && node.props.children === 'app.editor.server.retryStatus').props.onClick();
    render(); assert.equal(f.timers.size, 1);
    await f.tick(); render();
    assert.equal(state.statusUnavailable, false);
    assert.ok(calls.every(call => call.method === 'GET' && call.path === '/editor/server-render?job_id=job'));
    f.dispose(); assert.equal(f.timers.size, 0);
});

function localPanel({ transfer, getActor = () => actor, subscribe = () => () => {}, createError, quoteWait } = {}) {
    const timeline = JSON.parse(read('tests/fixtures/editorServerRender/v2.json'));
    const old = timeline.video[0].mediaId;
    timeline.media.local = { ...timeline.media[old], id: 'local' }; delete timeline.media[old];
    timeline.video.forEach(c => { c.mediaId = 'local'; });
    const document = { schema_version: 2, project_id: actor, brief: '', canvas: { aspect_ratio: '16:9', frame_rate: 30 }, timeline };
    const calls = []; let state;
    const f = fixture('app/veyrnox/_components/editor/ServerRenderPanel.js', 'RenderSession', {
        '../../_lib/editorServerRenderClient.mjs': client,
        '../../_lib/editorServerRenderUploads.mjs': { ...uploads, uploadRenderFiles: (files, options) => uploads.uploadRenderFiles(files, { ...options, transfer }) },
        '../../_lib/editorDelivery.mjs': { accountBoundCall: call => call },
        '../../_lib/editorProject.mjs': { documentForTimeline: doc => doc },
        '../../../lib/authClient': { getStoredUserId: getActor, onSessionChange: subscribe },
        '../ConfirmDialog': { ConfirmDialog: 'confirm-dialog' },
        '../../_lib/gateway': { makeIdempotencyKey: () => 'fixed-test-key', notifyBalanceChanged() {}, gatewayFetch: async (path, init) => {
            calls.push({ path, init });
            if (path.endsWith('/quote')) { await quoteWait?.(); return { credits: 1, resolution: '1080p' }; }
            if (path === '/uploads') return { key: `uploads/${actor}/${actor}.mp4`, upload_url: 'https://r2.test/put', headers: { 'Content-Type': 'video/mp4' }, content_type: 'video/mp4', expires_in: 900, reserved: true };
            if (createError) throw createError;
            return { job_id: actor, state: 'SUBMITTED', credits: 1 };
        } },
    });
    const props = { actor, project: { actor, document, savedAt: 'saved' }, timeline, height: 1080, label: 'Local edit',
        blobs: { current: new Map([['local', new Blob(['0123ftypisom0000'], { type: 'video/mp4' })]]) },
        onState: value => { state = typeof value === 'function' ? value(state) : value; } };
    const render = () => f.render({ ...props, state });
    return { f, calls, render, props };
}
test('local consent precedes all upload requests; Cancel sends nothing; confirm remaps only export copy', async () => {
    let puts = 0;
    const p = localPanel({ transfer: async () => { puts++; return { ok: true }; } });
    const original = structuredClone(p.props.project.document);
    let tree = p.render();
    await walk(tree).find(n => n.props.children === 'app.editor.server.getQuote').props.onClick(); tree = p.render();
    let dialog = walk(tree).find(n => n.type === 'confirm-dialog');
    assert.equal(dialog.props.confirmLabel, 'app.editor.server.uploadAndRender');
    assert.match(dialog.props.body, /uploadConsent/); assert.equal(p.calls.length, 1); assert.equal(puts, 0);
    dialog.props.onCancel(); tree = p.render(); assert.equal(p.calls.length, 1);
    await walk(tree).find(n => n.props.children === 'app.editor.server.getQuote').props.onClick(); tree = p.render();
    dialog = walk(tree).find(n => n.type === 'confirm-dialog'); await dialog.props.onConfirm();
    await new Promise(resolve => setImmediate(resolve));
    const create = p.calls.find(c => c.path === '/editor/server-render');
    assert.ok(create); const body = JSON.parse(create.init.body);
    assert.equal(body.quoted_credits, 1); assert.equal(body.document.timeline.video[0].mediaId, `u-${actor}`);
    assert.deepEqual(p.props.project.document, original); assert.equal(puts, 1); p.f.dispose();
});

test('file errors disappear when the snapshot identity changes', async () => {
    const p = localPanel();
    p.props.blobs.current.clear();
    let tree = p.render();
    await walk(tree).find(n => n.props.children === 'app.editor.server.getQuote').props.onClick();
    tree = p.render();
    const hasFileError = tree => walk(tree).some(n => n.type === 'p' && Array.isArray(n.props.children) && n.props.children.includes('app.editor.server.localMissing'));
    assert.equal(hasFileError(tree), true);
    p.props.label = 'Changed snapshot'; p.render();
    assert.equal(hasFileError(p.render()), false); p.f.dispose();
});

for (const stage of ['quote', 'upload']) test(`successful ${stage} clears stale file errors`, async () => {
    let complete;
    const wait = () => new Promise(resolve => { complete = resolve; });
    const p = localPanel(stage === 'quote' ? { quoteWait: wait } : { transfer: wait });
    let tree = p.render();
    let pending = walk(tree).find(n => n.props.children === 'app.editor.server.getQuote').props.onClick();
    if (stage === 'upload') {
        await pending; tree = p.render();
        pending = walk(tree).find(n => n.type === 'confirm-dialog').props.onConfirm();
        await new Promise(resolve => setImmediate(resolve));
    }
    // Simulate a stale per-file error while the asynchronous operation completes.
    p.f.setters[4]([{ code: 'localMissing' }]);
    assert.ok(walk(p.render()).some(n => Array.isArray(n.props.children) && n.props.children.includes('app.editor.server.localMissing')));
    complete({ ok: true }); await pending;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(walk(p.render()).some(n => Array.isArray(n.props.children) && n.props.children.includes('app.editor.server.localMissing')), false);
    p.f.dispose();
});

test('ownership refusal after local upload displays the expired-upload message', async () => {
    const p = localPanel({ transfer: async () => ({ ok: true }),
        createError: { status: 403, code: 'editor_render_media_not_owned', body: { error: 'editor_render_media_not_owned' } } });
    let tree = p.render();
    await walk(tree).find(n => n.props.children === 'app.editor.server.getQuote').props.onClick(); tree = p.render();
    await walk(tree).find(n => n.type === 'confirm-dialog').props.onConfirm();
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(walk(p.render()).some(n => n.props.children === 'app.editor.server.uploadExpired'));
    assert.equal(p.calls.find(c => c.path === '/uploads').init.preserveUploadErrors, true);
    assert.equal(client.renderError({ status: 403, code: 'editor_render_media_not_owned' }), 'app.editor.server.ownership');
    assert.equal(client.renderError({ status: 400, code: 'editor_render_media_not_owned', uploadedLocalFiles: true }), 'app.editor.server.ownership');
    p.f.dispose();
});
for (const cause of ['cancel', 'account']) test(`${cause} aborts active file and prevents create`, async () => {
    let changed, currentActor = actor, aborted = false;
    const p = localPanel({ getActor: () => currentActor, subscribe: fn => { changed = fn; return () => {}; },
        transfer: (_, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new DOMException('Aborted', 'AbortError')); }, { once: true })) });
    let tree = p.render(); await walk(tree).find(n => n.props.children === 'app.editor.server.getQuote').props.onClick(); tree = p.render();
    const pending = walk(tree).find(n => n.type === 'confirm-dialog').props.onConfirm();
    await new Promise(resolve => setImmediate(resolve)); tree = p.render();
    assert.ok(walk(tree).some(n => n.type === 'progress'));
    if (cause === 'account') { currentActor = 'other'; changed(); }
    else walk(tree).find(n => n.props.children === 'app.editor.server.abortFile').props.onClick();
    await pending; assert.equal(aborted, true); assert.equal(p.calls.some(c => c.path === '/editor/server-render'), false); p.f.dispose();
});
