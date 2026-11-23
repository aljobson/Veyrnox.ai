import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as client from '../lib/seedance25Client.mjs';

const require = createRequire(import.meta.url);
// Exercise the component's actual handlers and shared request session with a hook harness,
// following appLanguageControls.test.mjs; provider requests never leave the process.
function component(request) {
    const state = [], refs = [];
    let cursor = 0, refCursor = 0;
    const react = {
        useState(initial) {
            const index = cursor++;
            if (!(index in state)) state[index] = initial;
            return [state[index], value => { state[index] = value; }];
        },
        useRef(initial) { const index = refCursor++; return refs[index] ||= { current: initial }; },
        useEffect() {},
    };
    const dependencies = {
        react,
        'next/link': { default: 'a' },
        '../../../components/I18nProvider': { useI18n: () => ({ t: key => key }) },
        '../../../lib/seedance25Client.mjs': client,
        '../_lib/gateway': { gatewayFetch: request, makeIdempotencyKey: () => 'stable-web-key', notifyBalanceChanged() {} },
        '../_lib/uploadSourceFile': { uploadSourceFile() { assert.fail('owned asset must not upload'); } },
        '../../lib/authClient': { getSession: () => ({ user: { id: 'owner' } }) },
        '../_lib/useCatalog': { useCatalog: () => ({ models: [] }) },
    };
    const source = readFileSync('app/veyrnox/_components/Seedance25Actions.js', 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)(id => dependencies[id] || require(id), module, module.exports);
    return props => { cursor = 0; refCursor = 0; return module.exports.Seedance25Actions(props); };
}
function nodes(tree, match) {
    if (!tree || typeof tree !== 'object') return [];
    if (Array.isArray(tree)) return tree.flatMap(node => nodes(node, match));
    return [...(match(tree) ? [tree] : []), ...nodes(tree.props?.children, match)];
}
const model = { id: 'seedance-2.5-edit', credits: 76, media: { video: { required: true, maxFiles: 1 } } };
test('web hides gated placeholders', () => {
    assert.equal(component(() => assert.fail('no request'))({ models: [{ ...model, gated: true }], assetId: 'asset' }), null);
});
for(const task of ['edit','extend']) test(`web ${task}: confirms measured credits and shows no submitted cancel control`, async () => {
    const offer={...model,id:`seedance-2.5-${task}`,credits:task==='edit'?76:78};
    const credits=task==='edit'?152:78;
    const requests = [];
    const render = component(async (path, options) => {
        requests.push({ path, body: JSON.parse(options.body) });
        return path.endsWith('/quote') ? { model_id: offer.id, credits, units: task==='edit'?2:1, source_seconds: 5.055 } : { job_id: 'accepted-job' };
    });
    const props = { models: [offer], assetId: 'asset' };
    const button = (tree, key) => nodes(tree, node => node.type === 'button' && node.props.children === `app.seedance25.${key}`)[0];
    button(render(props), task).props.onClick();
    nodes(render(props), node => node.type === 'textarea')[0].props.onChange({ target: { value: 'Golden sky' } });
    await button(render(props), 'quote').props.onClick();
    await button(render(props), 'confirm').props.onClick();
    assert.equal(requests[1].body.confirmed_credits, credits);
    assert.deepEqual(requests[1].body.inputs, { prompt: 'Golden sky' });
    assert.deepEqual(requests[1].body.references, [{ slot: 'video', origin: 'asset', asset_id: 'asset' }]);
    const submitted = render(props);
    assert.equal(nodes(submitted, node => node.type === 'button').length, 0);
    assert.equal(submitted.props.href, '/app/library');
    assert.equal(submitted.props.children, 'app.seedance25.result');
});
