import test from 'node:test';
import assert from 'node:assert/strict';
import { hookHarness, nodes, readEditorSource } from './helpers/editorRoundHarness.mjs';
import { englishAppImports } from './helpers/appI18nStub.mjs';
const file = 'app/veyrnox/_components/editor/EditorUnavailable.js';
test('flag-off explanation is withheld during SSR and only displayed for a signed-in browser session', () => {
    let actor = 'owner', server = true, denied = 0;
    const h = hookHarness();
    const { EditorUnavailable } = h.load(file, {
        ...englishAppImports,
        react: { useSyncExternalStore: (_subscribe, snapshot, serverSnapshot) => server ? serverSnapshot() : snapshot() },
        '../../../lib/authClient': { getStoredUserId: () => actor, onSessionChange() {} },
        'next/navigation': { notFound: () => { denied++; throw new Error('NEXT_HTTP_ERROR_FALLBACK;404'); } },
        'next/link': { __esModule: true, default: 'a' }, '../Main': { Main: 'main' },
    });
    assert.equal(h.render(EditorUnavailable, {}), null);
    server = false;
    let tree = h.render(EditorUnavailable, {});
    assert.ok(nodes(tree).some(node => node.type === 'h1' && node.props.children === 'Editor not available'));
    assert.ok(nodes(tree).some(node => node.props?.href === '/app/library'));
    actor = null;
    assert.throws(() => h.render(EditorUnavailable, {}), /;404/); assert.equal(denied, 1);
    assert.match(readEditorSource('app/veyrnox/app/editor/layout.js'), /robots: \{ index: false, follow: false \}/);
});
