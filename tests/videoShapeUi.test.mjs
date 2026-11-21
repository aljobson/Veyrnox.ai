import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import * as shapes from '../lib/videoShape.mjs';
import * as queries from '../lib/videoShapeQueries.mjs';
import { serverRow } from '../app/veyrnox/_lib/libraryRows.js';
import { patchSmartCutMetadataState } from '../app/veyrnox/_lib/smartCut.js';
import { jobsPagePath } from '../lib/jobListCursor.js';
const require = createRequire(import.meta.url);
function load(path, mocks) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)(id => mocks[id] ?? require(id), module, module.exports);
    return module.exports;
}
function hooks(context = () => null) {
    const values = [], deps = [], cleanups = [];
    let cursor = 0, effects = [];
    const react = { ...React, useContext: context, useCallback: fn => fn,
        useState(initial) {
            const i = cursor++;
            if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial;
            return [values[i], value => { values[i] = typeof value === 'function' ? value(values[i]) : value; }];
        },
        useRef(initial) { const i = cursor++; return values[i] ??= { current: initial }; },
        useEffect(fn, next) {
            const i = cursor++;
            if (!deps[i] || next.some((value, n) => value !== deps[i][n])) {
                deps[i] = next; effects.push(() => { cleanups[i]?.(); cleanups[i] = fn(); });
            }
        },
    };
    return { react, render: fn => { cursor = 0; return fn(); }, async flush() { const pending = effects; effects = []; pending.forEach(fn => fn()); await new Promise(resolve => setImmediate(resolve)); } };
}
test('Load older retains dimensions and ambiguity through EditSheet live metadata', async () => {
    const h = hooks();
    let rows = [];
    const jobs = [
        { job_id: 'portrait', state: 'succeeded', has_asset: true, video_width: 1080, video_height: 1920, shape_ambiguous: false },
        { job_id: 'ambiguous', state: 'succeeded', has_asset: true, shape_ambiguous: true },
    ];
    const { useOlderLibraryJobs } = load('app/veyrnox/_lib/useOlderLibraryJobs.js', {
        react: h.react, './gateway': { gatewayFetch: async () => ({ jobs }) }, './libraryRows': { serverRow },
        '../../lib/authClient': { getStoredUserId: () => 'owner' }, '../../../lib/jobListCursor': { jobsPagePath },
    });
    const older = h.render(() => useOlderLibraryJobs({ actor: 'owner', nextCursor: { before: '2026-11-21T00:00:00Z', before_id: '11111111-1111-4111-8111-111111111111' },
        setNextCursor: () => {}, setRows: update => { rows = update(rows); }, setVisible: () => {}, pageSize: 12 }));
    await h.flush(); await older.loadOlder();
    assert.equal(rows[0].video_width, 1080); assert.equal(rows[0].video_height, 1920);
    assert.equal(rows[1].shape_ambiguous, true);
    const items = rows.map(row => ({ ...row, uid: row.job_id }));
    const state = patchSmartCutMetadataState({ items, editPast: [], editFuture: [] }, 'ambiguous', { width: 1920, height: 1080, ratio: '1.78', duration: 5 });
    assert.equal(shapes.mixedShapes(state.items), false);
    assert.equal(shapes.mixedShapes([...state.items].reverse()), false);
});
test('web Create refreshes its cached hint only after successful measurement on the same screen', async () => {
    let completed = '', resolveMeasurement, calls = 0, measured = false;
    const context = () => [completed, id => { completed = id; }];
    const h = hooks(context), warning = hooks(context);
    const request = async path => {
        if (path.endsWith('/shapes')) return new Promise(resolve => { resolveMeasurement = () => { measured = true; resolve({ shapes: [{ job_id: 'new', width: 1920, height: 1080 }] }); }; });
        calls++;
        return { jobs: [{ job_id: measured ? 'new' : 'old', state: 'succeeded', has_asset: true, video_width: measured ? 1920 : 1080, video_height: measured ? 1080 : 1920, shape_ambiguous: false }] };
    };
    const mocks = react => ({ react, '../../lib/authClient.js': { getSession: () => ({ user: { id: 'owner' } }) },
        '../../../components/I18nProvider': { useI18n: () => ({ t: key => key }) }, '../_lib/gateway': { gatewayFetch: request },
        '../../../lib/videoShape.mjs': shapes, '../../../lib/videoShapeQueries.mjs': queries,
        './VideoShapeBadge': { videoShapeLabel: item => shapes.itemShape(item) },
    });
    const { SmartCutShapeHint } = load('app/veyrnox/_components/SmartCutShapeHint.js', mocks(h.react));
    const other = load('app/veyrnox/_components/SmartCutShapeHint.js', mocks(warning.react));
    const renderHint = () => h.render(() => {
        const element = SmartCutShapeHint({ actor: 'owner', video: true, options: ['16:9', '9:16'], value: '16:9', onChange: () => {} });
        return element.type(element.props);
    });
    renderHint(); await h.flush(); assert.ok(renderHint()); assert.equal(calls, 1);
    const warningTree = warning.render(() => {
        const element = other.SmartCutShapeHint({ actor: 'owner', jobs: [{ job_id: 'new', state: 'succeeded', mime_type: 'video/mp4', aspect_ratio: 'auto' }] });
        return element.type(element.props);
    });
    const child = warningTree.props.children[0];
    warning.render(() => child.type(child.props)); await warning.flush();
    assert.equal(completed, ''); assert.equal(calls, 1);
    resolveMeasurement(); await warning.flush();
    assert.equal(completed, 'new'); renderHint(); await h.flush();
    assert.equal(renderHint(), null); assert.equal(calls, 2);
    renderHint(); await h.flush(); assert.equal(calls, 2);
});
