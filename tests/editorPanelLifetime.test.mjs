import test from 'node:test';
import assert from 'node:assert/strict';
import * as generation from '../app/veyrnox/_lib/editorGeneration.mjs';
import * as slots from '../lib/generationSourceSlots.mjs';
import { englishAppImports } from './helpers/appI18nStub.mjs';
import { hookHarness, nodes, readEditorSource } from './helpers/editorRoundHarness.mjs';
const file = 'app/veyrnox/_components/editor/GenerationPanel.js';
const model = { id: 'video', name: 'Video', kind: 'video', credits: 12, takesPrompt: true, promptMax: 2000, durations: [5], aspects: ['16:9'], media: {} };
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture({ upload, submit, sourceModel = model, allowance = false, panelProps = {}, jobState = () => 'running' } = {}) {
    const h = hookHarness(), calls = [], session = { user: { id: 'owner' } };
    let keys = 0;
    const gatewayFetch = async (path, options) => {
        calls.push({ path, body: options?.body ? JSON.parse(options.body) : null });
        if (path === '/balance') return { balance: 100 };
        if (path === '/free-allowance') return { enabled: allowance, left: allowance ? { [sourceModel.id]: 1 } : {} };
        if (path === '/generations') return submit ? submit() : { job_id: 'job-1', balance_after: 88 };
        if (path === '/jobs/job-1') return { state: jobState() };
        throw new Error(`Unexpected request ${path}`);
    };
    const gateway = { gatewayFetch, makeIdempotencyKey: () => `key-${++keys}`, notifyBalanceChanged() {} };
    const history = { pushJobHistory() {}, markJobSettled() {} };
    const jobs = h.load('app/veyrnox/_lib/useStudioJobs.js', { './gateway': gateway, './jobHistory': history });
    const catalog = { live: true, models: [sourceModel] };
    const { GenerationPanel } = h.load(file, {
        ...englishAppImports, '../Icon': { Icon: 'span' }, '../Button': { Button: 'button' },
        '../../_lib/useCatalog': { useCatalog: () => catalog }, '../../_lib/useStudioJobs': jobs,
        '../../_lib/gateway': gateway, '../../_lib/jobHistory': history,
        '../../../lib/authClient': { getSession: () => session, onSessionChange: () => () => {} },
        '../../_lib/editorGeneration.mjs': generation, '../../../../lib/generationSourceSlots.mjs': slots,
        '../../../../lib/generationPromptLimits.js': { GENERATION_PROMPT_MAX: 2000 },
        '../../../../lib/createAttach.mjs': { attachAccept: () => 'image/png' },
        '../../_lib/editorGenerationUploads.mjs': { generationFileProblem: () => null, generationFileType: () => 'image/png', uploadGenerationSources: upload || (async () => []) },
        '../../_lib/uploadConvert.mjs': { needsConversion: () => false, prepareUpload: async file => file },
        './GenerationSourceControls': { GenerationSourceControls: 'source-controls' },
    });
    const wrapper = hookHarness();
    const { KeepMountedPanel } = wrapper.load('app/veyrnox/_components/editor/KeepMountedPanel.js');
    let mounted = false, tree;
    const props = { onIngest() {}, intentRequest: { id: 'r1', intent: 'generate_video', prompt: 'A lake' }, ...panelProps };
    function render(active = true) {
        const shell = wrapper.render(KeepMountedPanel, { active, children: { type: GenerationPanel, props } });
        if (shell.props.children) { mounted = true; tree = h.render(GenerationPanel, shell.props.children.props); }
        else if (mounted) { h.dispose(); mounted = false; }
        return { shell, tree };
    }
    const confirm = () => nodes(tree).find(node => node.type === 'button' && typeof node.props.children === 'string' && /12/.test(node.props.children));
    const primary = () => nodes(tree).find(node => node.type === 'fieldset').props.children.flat(Infinity).find(node => node?.type === 'button');
    const usePrompt = () => { const button = nodes(tree).find(node => node.type === 'button' && node.props.children === 'Use this prompt'); assert.ok(button, 'new prompt requires an explicit use action'); button.props.onClick(); render(); };
    return { h, calls, props, catalog, render, confirm, primary, usePrompt, get keys() { return keys; } };
}
test('generation panels are absent initially and retain the same child after first use', () => {
    const h = hookHarness();
    const { KeepMountedPanel } = h.load('app/veyrnox/_components/editor/KeepMountedPanel.js');
    const child = { type: 'generation', props: {} };
    assert.equal(h.render(KeepMountedPanel, { active: false, children: child }).props.children, null);
    assert.equal(h.render(KeepMountedPanel, { active: true, children: child }).props.children, child);
    const hidden = h.render(KeepMountedPanel, { active: false, children: child });
    assert.equal(hidden.props.hidden, true); assert.equal(hidden.props.children, child);
    const workspace = readEditorSource('app/veyrnox/_components/editor/MultitrackWorkspace.js');
    assert.equal((workspace.match(/<KeepMountedPanel active=/g) || []).length, 3);
    assert.doesNotMatch(workspace, /panel\s*===.*&&\s*<GenerationPanel/);
});
test('switching during upload preserves the request key and completes the same upload', async () => {
    let finish, signal;
    const f = fixture({ sourceModel: { ...model, media: { image: { required: true, kind: 'image' } } }, upload: async (_uploads, options) => {
        signal = options.signal;
        await new Promise(resolve => { finish = resolve; });
        return [{ key: 'uploaded-image' }];
    } });
    assert.equal(f.render(false).tree, undefined);
    f.render(); await flush(); f.render(); f.usePrompt(); let { tree } = f.render();
    await nodes(tree).find(node => node.type === 'source-controls').props.onFile('image', new File(['photo'], 'photo.png', { type: 'image/png' }), 0);
    f.render(); const button = f.confirm(); assert.ok(button, 'exact catalog price must be visible on explicit confirmation');
    const sending = button.props.onClick(); f.render(false);
    assert.equal(signal.aborted, false); assert.equal(f.keys, 1);
    finish(); await sending; f.render(false);
    assert.equal(f.calls.filter(call => call.path === '/generations').length, 1);
    assert.equal(f.calls.find(call => call.path === '/generations').body.idempotency_key, 'key-1');
    f.h.dispose();
});
test('uncertain submission survives switching; a new prompt cannot replace its identity', async () => {
    let attempt = 0;
    const f = fixture({ submit: async () => { if (++attempt === 1) throw new Error('response lost'); return { job_id: 'job-1' }; } });
    f.render(); await flush(); f.render(); f.usePrompt(); await f.confirm().props.onClick();
    assert.equal(f.calls.find(call => call.path === '/generations').body.idempotency_key, 'key-1');
    assert.equal(f.render(false).shell.props.hidden, true); f.props.intentRequest = { id: 'r2', intent: 'generate_video', prompt: 'A different film' };
    f.render(); await flush(); const { tree } = f.render();
    assert.equal(nodes(tree).find(node => node.type === 'textarea').props.value, 'A lake');
    await f.confirm().props.onClick(); f.render();
    const posts = f.calls.filter(call => call.path === '/generations');
    assert.equal(posts.length, 2); assert.equal(posts[1].body.idempotency_key, 'key-1'); assert.deepEqual(posts[0].body, posts[1].body); assert.equal(f.keys, 1);
    f.h.dispose();
});
test('running jobs continue their real polling hook while their generation tool is hidden', async () => {
    const f = fixture(); f.render(); await flush(); f.render(); f.usePrompt();
    await f.confirm().props.onClick(); f.render();
    assert.equal(f.h.timers.size, 1);
    f.render(false); await f.h.tick(); f.render(false);
    assert.equal(f.calls.filter(call => call.path === '/jobs/job-1').length, 1);
    assert.equal(f.h.timers.size, 1); assert.equal(f.keys, 1);
    f.render(true); await f.h.tick();
    assert.equal(f.calls.filter(call => call.path === '/jobs/job-1').length, 2);
    const submissions = f.calls.filter(call => call.path === '/generations');
    assert.equal(submissions.length, 1); assert.equal(submissions[0].body.idempotency_key, 'key-1');
    assert.equal(f.keys, 1); assert.equal(f.h.timers.size, 1);
    f.h.dispose(); assert.equal(f.h.timers.size, 0);
});

const textOf = tree => nodes(tree).flatMap(node => [node.props?.children].flat(Infinity).filter(value => typeof value === 'string')).join(' ');
test('a busy prompt is discarded on unlock and a fresh request requires explicit application', async () => {
    const f = fixture({ panelProps: { disabled: true } });
    f.render(); await flush(); let { tree } = f.render();
    assert.match(textOf(tree), /editor is busy/i); assert.doesNotMatch(textOf(tree), /unconfirmed/i);
    assert.equal(nodes(tree).find(node => node.type === 'textarea').props.value, '');
    f.props.disabled = false; f.render(); await flush(); tree = f.render().tree;
    assert.equal(nodes(tree).find(node => node.type === 'textarea').props.value, '');
    assert.equal(nodes(tree).some(node => node.props?.children === 'Use this prompt'), false);
    f.props.intentRequest = { id: 'fresh', intent: 'generate_video', prompt: 'Fresh request' };
    f.render(); await flush(); tree = f.render().tree;
    assert.equal(nodes(tree).find(node => node.type === 'textarea').props.value, '');
    f.usePrompt(); tree = f.render().tree;
    assert.equal(nodes(tree).find(node => node.type === 'textarea').props.value, 'Fresh request');
    assert.doesNotMatch(textOf(tree), /editor is busy|unconfirmed/i);
    assert.equal(f.keys, 0); assert.equal(f.calls.filter(call => call.path === '/generations').length, 0); f.h.dispose();
});
test('an unconfirmed notice changes to busy while retrying and clears when the job settles', async () => {
    let attempt = 0, state = 'running';
    const f = fixture({ submit: async () => { if (++attempt === 1) throw new Error('lost'); return { job_id: 'job-1' }; }, jobState: () => state });
    f.render(); await flush(); f.render(); f.usePrompt(); await f.confirm().props.onClick();
    f.props.intentRequest = { id: 'r2', intent: 'generate_video', prompt: 'Deferred film' };
    f.render(); await flush(); let tree = f.render().tree;
    assert.match(textOf(tree), /earlier request is unconfirmed/i);
    await f.confirm().props.onClick(); f.render(); await flush(); tree = f.render().tree;
    assert.match(textOf(tree), /editor is busy/i); assert.doesNotMatch(textOf(tree), /earlier request is unconfirmed/i);
    assert.equal(nodes(tree).find(node => node.type === 'textarea').props.value, 'A lake');
    state = 'failed'; await f.h.tick(); f.render(); await flush(); tree = f.render().tree;
    assert.equal(nodes(tree).find(node => node.type === 'textarea').props.value, 'A lake');
    assert.equal(nodes(tree).some(node => node.props?.children === 'Use this prompt'), false);
    assert.doesNotMatch(textOf(tree), /editor is busy|earlier request is unconfirmed/i);
    assert.equal(f.keys, 1); assert.equal(f.calls.filter(call => call.path === '/generations').length, 2); f.h.dispose();
});
test('editing dismisses a waiting intent without later overwriting the user draft', async () => {
    const f = fixture({ submit: async () => { throw new Error('lost'); } });
    f.render(); await flush(); f.render(); f.usePrompt(); await f.confirm().props.onClick();
    f.props.intentRequest = { id: 'r2', intent: 'generate_video', prompt: 'Deferred film' };
    f.render(); await flush(); let tree = f.render().tree;
    assert.match(textOf(tree), /earlier request is unconfirmed/i);
    nodes(tree).find(node => node.type === 'textarea').props.onChange({ target: { value: 'My draft' } });
    tree = f.render().tree;
    assert.doesNotMatch(textOf(tree), /earlier request is unconfirmed/i);
    assert.equal(nodes(tree).find(node => node.type === 'textarea').props.value, 'My draft');
    f.props.disabled = true; f.render(); await flush(); f.props.disabled = false; f.render(); await flush(); tree = f.render().tree;
    assert.equal(nodes(tree).find(node => node.type === 'textarea').props.value, 'My draft'); f.h.dispose();
});
const pricePanels = [
    ['video', model, {}, null],
    ['voiceover', { ...model, id: 'voice', kind: 'audio', isSpeech: true }, { voiceover: true }, null],
    ['avatar', { ...model, id: 'avatar', media: { image: { required: true }, audio: { required: true, maxSeconds: 10 } } }, { avatar: true }, null],
    ['movement', { ...model, media: { image: { required: true } } }, {}, 'movement'],
    ['separation', { ...model, id: 'demucs-stems', kind: 'audio', takesPrompt: false, media: { audio: { required: true, maxSeconds: 120 } }, outputStems: ['vocals', 'drums', 'bass', 'other', 'guitar', 'piano'] }, { voiceover: true }, 'separation'],
];
for (const [name, sourceModel, panelProps, mode] of pricePanels) {
    for (const price of ['paid', 'allowance', 'zero']) test(`${name} keeps the correct explicit action label for ${price} catalog quotes`, async () => {
        const f = fixture({ sourceModel: { ...sourceModel, credits: price === 'zero' ? 0 : 12 }, allowance: price === 'allowance', panelProps: { ...panelProps, intentRequest: null } });
        f.render(); await flush(); let tree = f.render().tree;
        if (mode) {
            const select = nodes(tree).find(node => node.type === 'select' && (node.props['data-testid'] === 'editor-generation-type' || node.props['aria-label'] === 'Audio generation tool'));
            assert.ok(select, name); select.props.onChange({ target: { value: mode } }); tree = f.render().tree;
        }
        const expected = mode === 'separation' ? 'Separate audio' : mode === 'movement' ? 'Generate movement' : price === 'paid' ? 'Confirm 12 credits' : 'Generate';
        assert.equal(f.primary().props.children, expected);
        assert.equal(f.keys, 0); assert.equal(f.calls.filter(call => call.path === '/generations').length, 0); f.h.dispose();
    });
}

test('unlock clears the busy notice even while the catalog is unavailable, and does not restore the discarded prompt', async () => {
    const f = fixture({ panelProps: { disabled: true } });
    f.render(); await flush(); let tree = f.render().tree;
    assert.match(textOf(tree), /editor is busy/i);
    f.catalog.live = false; f.props.disabled = false; f.render(); await flush(); tree = f.render().tree;
    assert.doesNotMatch(textOf(tree), /editor is busy|earlier request is unconfirmed/i);
    assert.equal(nodes(tree).find(node => node.type === 'textarea').props.value, '');
    f.catalog.live = true; f.render(); await flush(); tree = f.render().tree;
    assert.equal(nodes(tree).find(node => node.type === 'textarea').props.value, '');
    assert.equal(f.keys, 0); f.h.dispose();
});

test('a new unblocked intent does not overwrite a draft until Use this prompt is clicked', async () => {
    const f = fixture(); f.render(); await flush(); let tree = f.render().tree;
    assert.equal(nodes(tree).find(node => node.type === 'textarea').props.value, '');
    f.usePrompt(); tree = f.render().tree;
    assert.equal(nodes(tree).find(node => node.type === 'textarea').props.value, 'A lake');
    f.props.intentRequest = { id: 'r2', intent: 'generate_video', prompt: 'Another lake' };
    f.render(); await flush(); tree = f.render().tree;
    assert.equal(nodes(tree).find(node => node.type === 'textarea').props.value, 'A lake');
    f.usePrompt(); tree = f.render().tree;
    assert.equal(nodes(tree).find(node => node.type === 'textarea').props.value, 'Another lake');
    assert.equal(f.keys, 0); assert.equal(f.calls.filter(call => call.path === '/generations').length, 0); f.h.dispose();
});

test('a block ending before the notice microtask cannot revive the blocked prompt', async () => {
    const f = fixture({ panelProps: { disabled: true } });
    f.render(); f.props.disabled = false; f.render(); await flush(); const tree = f.render().tree;
    assert.equal(nodes(tree).find(node => node.type === 'textarea').props.value, '');
    assert.equal(nodes(tree).some(node => node.props?.children === 'Use this prompt'), false);
    assert.equal(f.keys, 0); f.h.dispose();
});
