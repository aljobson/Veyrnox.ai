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
        useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot(); },
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
test('web Create loads with a stored owner and null session, naming exact dimensions in both hint sentences', async () => {
    const h = hooks(() => ['', () => {}]);
    const t = translator('en', english);
    const i18n = { useI18n: () => ({ t }) };
    const badge = load('app/veyrnox/_components/VideoShapeBadge.js', { '../../../components/I18nProvider': i18n, '../../../lib/videoShape.mjs': shapes });
    const { SmartCutShapeHint } = load('app/veyrnox/_components/SmartCutShapeHint.js', {
        react: h.react, '../../lib/authClient.js': { getSession: () => null, getStoredUserId: () => 'owner', onSessionChange: () => () => {} },
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
test('web Create subscribes to stored identity and does not cache a missing session', async () => {
    const h = hooks(() => ['', () => {}]);
    let owner = null, changed, calls = 0;
    const onSessionChange = fn => { changed = fn; return () => {}; };
    const getStoredUserId = () => owner;
    const { SmartCutShapeHint } = load('app/veyrnox/_components/SmartCutShapeHint.js', {
        react: { ...h.react, useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) {
            assert.equal(subscribe, onSessionChange); assert.equal(getSnapshot, getStoredUserId);
            assert.equal(getServerSnapshot(), null); subscribe(() => {}); return getSnapshot();
        } },
        '../../lib/authClient.js': { getSession: () => null, getStoredUserId, onSessionChange },
        '../../../components/I18nProvider': { useI18n: () => ({ t: key => key }) },
        '../../../lib/videoShape.mjs': shapes, '../../../lib/videoShapeQueries.mjs': queries,
        './VideoShapeBadge': { videoShapeLabel: item => shapes.itemShape(item) },
        '../_lib/gateway': { gatewayFetch: async () => {
            calls++; return { jobs: [{ state: 'succeeded', has_asset: true, video_width: 1080, video_height: 1920 }] };
        } },
    });
    const render = () => h.render(() => {
        const element = SmartCutShapeHint({ video: true, options: ['16:9', '9:16'], value: '16:9' });
        return element.type(element.props);
    });
    assert.equal(render(), null); await h.flush(); assert.equal(calls, 0);
    owner = 'owner'; changed(); render(); await h.flush();
    assert.ok(render()); assert.equal(calls, 1);
    owner = null; changed(); assert.equal(render(), null); await h.flush();
    owner = 'other'; changed(); assert.equal(render(), null); await h.flush();
    assert.ok(render()); assert.equal(calls, 2);
});
test('web finished warning names Landscape 1280x768 when 16:9 was requested', async () => {
    const parent = hooks(() => ['', () => {}]), child = hooks(() => ['', () => {}]);
    let active = parent;
    const react = { ...React };
    for (const key of ['useState', 'useEffect', 'useContext', 'useSyncExternalStore']) react[key] = (...args) => active.react[key](...args);
    const t = translator('en', english);
    const i18n = { useI18n: () => ({ t }) };
    const badge = load('app/veyrnox/_components/VideoShapeBadge.js', { '../../../components/I18nProvider': i18n, '../../../lib/videoShape.mjs': shapes });
    const { SmartCutShapeHint } = load('app/veyrnox/_components/SmartCutShapeHint.js', {
        react, '../../lib/authClient.js': { getStoredUserId: () => 'owner', onSessionChange: () => () => {} },
        '../../../components/I18nProvider': i18n, '../../../lib/videoShape.mjs': shapes,
        '../../../lib/videoShapeQueries.mjs': queries, './VideoShapeBadge': badge,
        '../_lib/gateway': { gatewayFetch: async () => ({ shapes: [{ job_id: 'new', width: 1280, height: 768 }] }) },
    });
    const element = parent.render(() => {
        const hint = SmartCutShapeHint({ jobs: [{ job_id: 'new', state: 'succeeded', mime_type: 'video/mp4', aspect_ratio: '16:9' }] });
        return hint.type(hint.props).props.children[0];
    });
    active = child;
    const render = () => child.render(() => element.type(element.props));
    render(); await child.flush();
    assert.match(render().props.children, /Landscape 1280x768/);
    assert.match(render().props.children, /16:9/);
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
        './SmartCutAnalyse': { SmartCutAnalyse: 'analyse' }, './SmartCutWorkbench': { SmartCutWorkbench: 'workbench' },
        // The sheet reads each clip's sound before any paid step; no `has_audio` here means it could not be read.
        '../_lib/gateway': { gatewayFetch: async () => ({}) },
    });
    const clips = [1030, 1000, 1060].map((width, i) => ({ job_id: String(i), video_width: width, video_height: 1000 }));
    const renderSheet = () => sheet.render(() => EditSheet({ clips, audios: [], credits5s: 1, smartCut: true }));
    nodes(renderSheet()).filter(n => n.props?.onMetadata).forEach(n => n.props.onMetadata({ duration: 10 }));
    await sheet.flush();
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
    const mocks = react => ({ react, '../../lib/authClient.js': { getSession: () => null, getStoredUserId: () => 'owner', onSessionChange: () => () => {} },
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
test('no paid Smart Cut step is open while the clips\' sound is still being read, or when they mix sound and silence', async () => {
    const sound = { 0: true, 1: false };
    const build = (audioFor) => {
        const sheet = hooks(), planner = hooks();
        const common = { '../../../components/I18nProvider': { useI18n: () => ({ t: key => key, locale: 'en' }) },
            '../../../lib/i18n/locales.mjs': { localeTag: () => 'en' }, '../_lib/useAssetUrl': {}, '../_lib/smartCut': smartCut };
        const { SmartCutPlanner } = load('app/veyrnox/_components/SmartCutPlanner.js', { ...common, react: planner.react, '../_lib/smartCutAnalysis': {}, '../_lib/smartCutFillers': {} });
        const { EditSheet } = load('app/veyrnox/_components/EditSheet.js', {
            ...common, react: sheet.react, '../../../lib/videoShape.mjs': shapes,
            '../../../lib/i18n/translate.mjs': { pluralKey: (_t, _locale, key) => key },
            'next/link': 'a', './VideoShapeBadge': { VideoShapeBadge: 'badge' }, './Modal': { Modal: 'modal' },
            './AssetLoadStatus': {}, './ConfirmDialog': { ConfirmDialog: 'confirm' }, './SmartCutPlanner': { SmartCutPlanner },
            './SmartCutAnalyse': { SmartCutAnalyse: 'analyse' }, './SmartCutWorkbench': { SmartCutWorkbench: 'workbench' },
            '../_lib/gateway': { gatewayFetch: async (path) => ({ has_audio: audioFor(decodeURIComponent(path.split('/')[2])) }) },
        });
        const clips = [0, 1].map((i) => ({ job_id: String(i), video_width: 1000, video_height: 1000 }));
        const render = () => sheet.render(() => EditSheet({ clips, audios: [], credits5s: 1, smartCut: true }));
        const analyse = () => nodes(render()).find(n => n.type === 'analyse').props;
        const planning = () => nodes(render()).find(n => n.type === SmartCutPlanner).props.planningDisabled;
        nodes(render()).filter(n => n.props?.onMetadata).forEach(n => n.props.onMetadata({ duration: 10 }));
        return { sheet, planning, analyse };
    };
    const same = build(() => true);
    assert.equal(same.planning(), true, 'blocked before the sound is known');
    assert.equal(same.analyse().disabled, true);
    await same.sheet.flush();
    assert.equal(same.planning(), false, 'open once both clips have sound');
    assert.equal(same.analyse().disabled, true, 'the paid analysis stays off while Smart Cut Create is paused');
    const mixed = build((id) => sound[id]);
    await mixed.sheet.flush();
    assert.equal(mixed.planning(), true, 'blocked for sound beside silence');
    assert.equal(mixed.analyse().disabled, true);
});
