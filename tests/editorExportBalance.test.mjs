import test from 'node:test';
import assert from 'node:assert/strict';
import { hookHarness, nodes } from './helpers/editorRoundHarness.mjs';
import { englishAppImports } from './helpers/appI18nStub.mjs';
import * as client from '../app/veyrnox/_lib/editorServerRenderClient.mjs';
import * as uploads from '../app/veyrnox/_lib/editorServerRenderUploads.mjs';
const file = 'app/veyrnox/_components/editor/ServerRenderPanel.js';
const flush = () => new Promise(resolve => setImmediate(resolve));
function setup(fetchBalance) {
    let actor = 'owner';
    const calls = [], h = hookHarness();
    const mocks = {
        ...englishAppImports,
        '../../../lib/authClient': { getStoredUserId: () => actor, onSessionChange: () => () => {} },
        '../../_lib/editorServerRenderClient.mjs': { ...client, serverRenderVisible: () => true },
        '../../_lib/editorServerRenderUploads.mjs': uploads,
        '../../_lib/gateway': { gatewayFetch: async (path, options) => { calls.push({ path, options }); return fetchBalance(); } },
        '../../_lib/editorProject.mjs': { documentForTimeline: doc => doc },
        '../Button': { Button: 'button' }, '../ConfirmDialog': { ConfirmDialog: 'confirm-dialog' },
    };
    const { ServerRenderPanel } = h.load(file, mocks);
    const body = props => {
        const child = hookHarness();
        const { RenderSession } = child.load(file, mocks, ['RenderSession']);
        const tree = child.render(RenderSession, { timeline: {}, height: 720, label: 'Edit', onState() {}, ...props });
        child.dispose(); return tree;
    };
    return { h, calls, body, render: () => h.render(ServerRenderPanel, { mode: 'on' }), actor: value => { actor = value; } };
}
test('opening Export loads and displays its own balance without ever mounting Generate', async () => {
    const f = setup(async () => ({ balance: 73 }));
    f.render(); await flush(); const panel = f.render();
    assert.deepEqual(f.calls.map(call => call.path), ['/balance']);
    assert.deepEqual(panel.props.balanceInfo, { actor: 'owner', balance: 73 });
    const balance = nodes(f.body(panel.props)).find(node => node.props?.['data-testid'] === 'editor-export-balance');
    assert.match(balance.props.children, /73/);
    assert.equal(f.calls.some(call => call.path.includes('generation')), false); f.h.dispose();
});
test('export balance ignores a late response from a different account', async () => {
    const resolvers = [];
    const f = setup(() => new Promise(resolve => resolvers.push(resolve)));
    f.render(); f.actor('other'); f.render();
    resolvers[0]({ balance: 999 }); await flush();
    assert.notEqual(f.render().props.balanceInfo?.balance, 999);
    resolvers[1]({ balance: 12 }); await flush();
    assert.deepEqual(f.render().props.balanceInfo, { actor: 'other', balance: 12 }); f.h.dispose();
});
