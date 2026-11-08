import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const base = 'app/veyrnox/_components/editor/';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
function component(file, name, mocks = {}) {
    const exports = {};
    const code = ts.transpileModule(read(base + file), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
    new Function('require', 'exports', code)(id => mocks[id] || (id === 'react/jsx-runtime' ? require(id) : id === 'react' ? { useState: value => [value, () => {}] } : id.endsWith('I18nProvider') ? { useI18n: () => ({ t: key => key }) } : id.endsWith('translate.mjs') ? { tOr: (t, key) => t(key) } : { Button: 'button' }), exports);
    return exports[name];
}
function nodes(tree) {
    if (!tree || typeof tree !== 'object') return [];
    return [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
}
test('simple rail exposes exactly six primary tools; advanced tools stay in More tools', () => {
    const Rail = component('EditorToolRail.js', 'EditorToolRail');
    const tree = Rail({ panel: 'Media', onPanel() {}, scenes: true, clipper: true, agent: true });
    const primary = nodes(tree).filter(node => node.props?.['data-primary-tool']);
    assert.deepEqual(primary.map(node => node.props['data-primary-tool']), ['Media', 'Text', 'Captions', 'Audio', 'Generate', 'Export']);
    assert.equal(nodes(tree).filter(node => node.type === 'details').length, 1);
    assert.equal(nodes(tree).some(node => node.props?.['data-testid'] === 'editor-tool-Plugins'), true);
});
test('empty state renders one working primary add-media action in both workspace entry points', () => {
    const Empty = component('EditorEmptyState.js', 'EditorEmptyState');
    let calls = 0;
    const tree = Empty({ onAdd: () => calls++, disabled: false });
    const actions = nodes(tree).filter(node => node.props?.['data-testid'] === 'editor-empty-add');
    assert.equal(actions.length, 1);
    actions[0].props.onClick(); assert.equal(calls, 1);
    for (const path of ['app/veyrnox/app/editor/page.js', base + 'MultitrackWorkspace.js']) assert.match(read(path), /<EditorEmptyState\b[^>]*onAdd=/);
});

test('real legacy and multitrack first-run renders contain one primary empty action; no generation panels mount', async () => {
    const React = await import('react');
    const { fixture } = await import('./helpers/publicSiteRender.mjs');
    const { appMessagesFor } = await import('../lib/i18n/appMessages.mjs');
    const messages = await appMessagesFor('en');
    for (const [file, name] of [['app/veyrnox/app/editor/page.js', 'Editor'], [base + 'MultitrackWorkspace.js', 'MultitrackWorkspace']]) {
        const f = fixture('en', '/app/editor', { messages, signedIn: true, expose: name === 'Editor' ? { [file]: ['Editor'] } : {} });
        const html = f.render(React.createElement(f.load(file)[name], { onCredits() {} }));
        assert.equal((html.match(/data-testid="editor-empty-add"/g) || []).length, 1, file);
        assert.ok(html.includes(messages['app.editor.simple.empty']));
        assert.equal((html.match(/data-testid="editor-generation"/g) || []).length, 0, 'generation panels must wait for first use');
    }
});

test('an empty timeline can open Asset packs and ingest its first verified file', async () => {
    const { hookHarness } = await import('./helpers/editorRoundHarness.mjs');
    const { englishAppImports } = await import('./helpers/appI18nStub.mjs');
    const packs = await import('../app/veyrnox/_lib/editorAssetPacks.mjs');
    let panel = 'Media';
    const Rail = component('EditorToolRail.js', 'EditorToolRail');
    const rail = Rail({ panel, pluginsUsed: false, onPanel: value => { panel = value; } });
    const more = nodes(rail).find(node => node.type === 'details');
    const entry = nodes(more).find(node => node.props?.['data-testid'] === 'editor-tool-Plugins');
    assert.ok(entry); assert.equal(entry.props.title, 'app.editor.simple.assetPacks');
    entry.props.onClick(); assert.equal(panel, 'Plugins');
    assert.match(read(base + 'MultitrackWorkspace.js'), /panel\s*===\s*'Plugins' && <AssetPackPanel disabled=\{disabled\} onIngest=\{ingest\}/);
    const h = hookHarness(), ingested = [];
    const { AssetPackPanel } = h.load(base + 'AssetPackPanel.js', {
        ...englishAppImports, '../Button': { Button: 'button' }, '../../_lib/editorAssetPacks.mjs': packs,
    });
    const props = { onIngest: (...args) => ingested.push(args) };
    const original = new File([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], 'picture.png', { type: 'image/png' });
    const pack = await packs.createAssetPack([original], { name: 'First pack', credit: 'Creator', usage: 'Original artwork', url: '' });
    let tree = h.render(AssetPackPanel, props);
    const manifest = nodes(tree).find(node => node.type === 'input' && node.props.accept === '.json,application/json');
    await manifest.props.onChange({ target: { files: [new File([JSON.stringify(pack)], 'pack.json')], value: 'pack.json' } });
    tree = h.render(AssetPackPanel, props);
    nodes(tree).find(node => node.type === 'input' && node.props.multiple).props.onChange({ target: { files: [original], value: 'picture.png' } });
    nodes(tree).find(node => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: true } });
    tree = h.render(AssetPackPanel, props);
    const insert = nodes(tree).find(node => node.type === 'button' && node.props['aria-label']?.startsWith('Insert'));
    assert.equal(insert.props.disabled, false); await insert.props.onClick();
    assert.equal(ingested.length, 1); assert.equal(ingested[0][0], original);
    assert.match(ingested[0][4].folder, /^Asset packs\//); h.dispose();
});

test('core commands stay visible with More tools closed in every mobile stage', async () => {
    const React = await import('react');
    const { fixture } = await import('./helpers/publicSiteRender.mjs');
    const { appMessagesFor } = await import('../lib/i18n/appMessages.mjs');
    const messages = await appMessagesFor('en'), file = base + 'MultitrackWorkspace.js';
    for (const stage of ['preview', 'media', 'timeline', 'inspector']) {
        const source = read(file).replace("[mobileStage,setMobileStage]=useState('preview')", `[mobileStage,setMobileStage]=useState('${stage}')`);
        const f = fixture('en', '/app/editor', { messages, signedIn: true, sourceOverrides: { [file]: source } });
        const html = f.render(React.createElement(f.load(file).MultitrackWorkspace, { onCredits() {} }));
        assert.match(html, new RegExp(`aria-pressed="true"[^>]*data-testid="editor-stage-${stage}"`));
        // Check actual rendered ancestors: hidden rail/media/viewport containers must not own core commands.
        const stack = [];
        let count = 0;
        for (const match of html.matchAll(/<(\/?)([a-z][\w-]*)([^>]*)>/g)) {
            const [, closing, tag, attrs] = match;
            if (closing) { stack.pop(); continue; }
            if (tag === 'button' && /aria-label="(Undo|Redo|Duplicate|Split|Delete)"/.test(attrs)) {
                count++;
                for (const attributes of [...stack, attrs]) {
                    const classes = attributes.match(/class="([^"]*)"/)?.[1] || '';
                    assert.doesNotMatch(classes, /(?:^|\s)(?:[\w-]+:)?hidden(?:\s|$)/, `${stage}: ${attrs}`);
                    assert.doesNotMatch(attributes, /(?:^|\s)hidden(?:=|\s|$)/);
                }
            }
            if (!['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'].includes(tag)) stack.push(attrs);
        }
        assert.equal(count, 5, stage);
    }
});
