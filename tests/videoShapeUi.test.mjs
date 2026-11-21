import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import * as shapes from '../lib/videoShape.mjs';
import * as queries from '../lib/videoShapeQueries.mjs';
import { serverRow } from '../app/veyrnox/_lib/libraryRows.js';
import * as smartCut from '../app/veyrnox/_lib/smartCut.js';
import * as libraryFilter from '../app/veyrnox/_lib/libraryFilter.js';
import { translator } from '../lib/i18n/translate.mjs';
import english from '../lib/i18n/messages/app/en.mjs';
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
    const react = { ...React, useContext: context, useCallback: fn => fn, useMemo: fn => fn(),
        useState(initial) {
            const i = cursor++;
            if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial;
            return [values[i], value => { values[i] = typeof value === 'function' ? value(values[i]) : value; }];
        },
        useRef(initial) { const i = cursor++; return values[i] ??= { current: initial }; },
        useEffect(fn, next) {
            const i = cursor++;
            if (!next || !deps[i] || next.some((value, n) => value !== deps[i][n])) {
                deps[i] = next; effects.push(() => { cleanups[i]?.(); cleanups[i] = fn(); });
            }
        },
    };
    return { react, render: fn => { cursor = 0; return fn(); }, async flush() { const pending = effects; effects = []; pending.forEach(fn => fn()); await new Promise(resolve => setImmediate(resolve)); } };
}
function nodes(tree) {
    if (!tree || typeof tree !== 'object') return [];
    if (Array.isArray(tree)) return tree.flatMap(nodes);
    return [tree, ...nodes(tree.props?.children)];
}
test('web measures older unknown videos before Portrait filtering within the loaded window', async () => {
    const h = hooks(), calls = [];
    let finish;
    const base = { state: 'succeeded', mime_type: 'video/mp4', has_asset: true };
    const rows = [{ ...base, job_id: 'older' }, { ...base, job_id: 'not-favourite' },
        { ...base, job_id: 'failed', state: 'failed' }, { ...base, job_id: 'image', mime_type: 'image/png' },
        { ...base, job_id: 'outside-window' }];
    const filters = { state: 'succeeded', kind: 'video', shape: 'portrait', favourites: ['older', 'failed', 'image', 'outside-window'] };
    const { useLibraryShapes } = load('app/veyrnox/_lib/useLibraryShapes.js', {
        react: h.react, './libraryFilter': libraryFilter, '../../../lib/videoShape.mjs': shapes,
        './gateway': { gatewayFetch: async (_path, opts) => { calls.push(JSON.parse(opts.body).job_ids); return new Promise(resolve => { finish = resolve; }); } },
    });
    const render = () => h.render(() => useLibraryShapes(rows, 4, 'owner', [], filters));
    assert.deepEqual(libraryFilter.filterRows(render(), filters, []), []);
    await h.flush(); render(); await h.flush();
    assert.deepEqual(calls, [['older']], 'only one request in flight, with other filters and window retained');
    finish({ shapes: [{ job_id: 'older', width: 1080, height: 1920 }] }); await h.flush();
    assert.deepEqual(libraryFilter.filterRows(render(), filters, []).map(row => row.job_id), ['older']);
    await h.flush(); assert.equal(calls.length, 1, 'the tried id is not requested again');
});
test('web Create names a nonstandard previous shape with dimensions in both hint sentences', async () => {
    const h = hooks(() => ['', () => {}]);
    const t = translator('en', english);
    const i18n = { useI18n: () => ({ t }) };
    const badge = load('app/veyrnox/_components/VideoShapeBadge.js', { '../../../components/I18nProvider': i18n, '../../../lib/videoShape.mjs': shapes });
    const { SmartCutShapeHint } = load('app/veyrnox/_components/SmartCutShapeHint.js', {
        react: h.react, '../../lib/authClient.js': { getSession: () => ({ user: { id: 'owner' } }) },
        '../../../components/I18nProvider': i18n, '../../../lib/videoShape.mjs': shapes,
        '../../../lib/videoShapeQueries.mjs': queries, './VideoShapeBadge': badge,
        '../_lib/gateway': { gatewayFetch: async () => ({ jobs: [{ job_id: 'old', state: 'succeeded', has_asset: true, video_width: 1280, video_height: 768 }] }) },
    });
    const render = () => h.render(() => {
        const element = SmartCutShapeHint({ actor: 'owner', video: true, options: ['16:9', '9:16'], value: '16:9', onChange: () => assert.fail('must not change automatically') });
        return element.type(element.props);
    });
    render(); await h.flush();
    const paragraphs = nodes(render()).filter(node => node.type === 'p');
    assert.equal(paragraphs.length, 2);
    for (const paragraph of paragraphs) assert.match(paragraph.props.children, /Landscape 1280x768/);
});
test('applying a plan can change the shape anchor; planning blocks but Undo restores the snapshot', async () => {
    const sheet = hooks(), planner = hooks();
    const common = { '../../../components/I18nProvider': { useI18n: () => ({ t: key => key, locale: 'en' }) },
        '../../../lib/i18n/locales.mjs': { localeTag: () => 'en' }, '../_lib/useAssetUrl': {}, '../_lib/smartCut': smartCut };
    const { SmartCutPlanner } = load('app/veyrnox/_components/SmartCutPlanner.js', {
        ...common, react: planner.react, '../_lib/smartCutAnalysis': {}, '../_lib/smartCutFillers': {},
    });
    const { EditSheet } = load('app/veyrnox/_components/EditSheet.js', {
        ...common, react: sheet.react, '../../../lib/videoShape.mjs': shapes,
        '../../../lib/i18n/translate.mjs': { pluralKey: (_t, _locale, key) => key },
        'next/link': 'a', './VideoShapeBadge': { VideoShapeBadge: 'badge' }, './Modal': { Modal: 'modal' },
        './AssetLoadStatus': {}, './ConfirmDialog': { ConfirmDialog: 'confirm' }, './SmartCutPlanner': { SmartCutPlanner },
        './SmartCutAnalyse': { SmartCutAnalyse: 'analyse' }, './SmartCutWorkbench': { SmartCutWorkbench: 'workbench' }, '../_lib/gateway': {},
    });
    const clips = [1030, 1000, 1060].map((width, i) => ({ job_id: String(i), video_width: width, video_height: 1000 }));
    const renderSheet = () => sheet.render(() => EditSheet({ clips, audios: [], credits5s: 1, smartCut: true }));
    nodes(renderSheet()).filter(n => n.props?.onMetadata).forEach(n => n.props.onMetadata({ duration: 10 }));
    const props = () => nodes(renderSheet()).find(n => n.type === SmartCutPlanner).props;
    const renderPlanner = (overrides = {}) => planner.render(() => SmartCutPlanner({ ...props(), ...overrides }));
    const button = (tree, name) => nodes(tree).find(n => n.type === 'button' && n.props.children === `app.smartCut.action.${name}`);
    const snapshot = props().clips;
    assert.equal(shapes.mixedShapes(snapshot), false);
    button(renderPlanner(), 'createPreview').props.onClick();
    const select = nodes(renderPlanner()).find(n => n.type === 'select');
    select.props.onChange({ target: { value: snapshot[1].uid } });
    button(renderPlanner(), 'apply').props.onClick();
    assert.equal(shapes.mixedShapes(props().clips), true);
    assert.equal(props().planningDisabled, true);
    const after = renderPlanner();
    assert.equal(button(after, 'plan').props.disabled, true);
    assert.equal(button(after, 'undo').props.disabled, false);
    assert.equal(button(renderPlanner({ disabled: true }), 'undo').props.disabled, true);
    button(renderPlanner(), 'undo').props.onClick();
    assert.deepEqual(props().clips, snapshot);
    assert.equal(props().planningDisabled, false);
    assert.equal(props().onUndo, null);
});
test('a mismatch blocks creating and applying even an already open plan', () => {
    const h = hooks();
    let blocked = false, applied = 0;
    const { SmartCutPlanner } = load('app/veyrnox/_components/SmartCutPlanner.js', {
        react: h.react, '../../../components/I18nProvider': { useI18n: () => ({ t: key => key, locale: 'en' }) },
        '../../../lib/i18n/locales.mjs': { localeTag: () => 'en' }, '../_lib/useAssetUrl': {},
        '../_lib/smartCut': smartCut, '../_lib/smartCutAnalysis': {}, '../_lib/smartCutFillers': {},
    });
    const render = () => h.render(() => SmartCutPlanner({ clips: [{ job_id: 'a', duration: 10, out_s: 10 }], startOpen: true,
        planningDisabled: blocked, onApply: () => applied++ }));
    const button = name => nodes(render()).find(n => n.type === 'button' && n.props.children === `app.smartCut.action.${name}`);
    blocked = true;
    assert.equal(button('createPreview').props.disabled, true);
    button('createPreview').props.onClick(); assert.equal(button('apply'), undefined);
    blocked = false; button('createPreview').props.onClick();
    blocked = true; assert.equal(button('apply').props.disabled, true);
    button('apply').props.onClick(); assert.equal(applied, 0);
});
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
