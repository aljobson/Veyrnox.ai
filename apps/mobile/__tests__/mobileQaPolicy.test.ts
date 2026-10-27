import ts from 'typescript';
import { BODY_MAX_FONT_SCALE, HEADING_MAX_FONT_SCALE, HEADER_MAX_FONT_SCALE, fontScaleCap } from '../src/lib/a11y';
import { RAMP, TEXT_SCALE } from '../src/theme';
import { createTileColumns } from '../src/lib/createLayout';
import { allowTurnstileNavigation, turnstileOrigins } from '../src/lib/auth/turnstile';
declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs'), path = require('path');
const source = (file: string) => fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');

test('all text roles have one finite cap, preserving title/body hierarchy at every app size', () => {
    expect(HEADER_MAX_FONT_SCALE).toBe(1.3);
    expect(HEADING_MAX_FONT_SCALE).toBe(1.5);
    for (const variant of Object.keys(RAMP)) expect(fontScaleCap(variant)).toBeGreaterThan(1);
    for (const scale of Object.values(TEXT_SCALE)) for (const system of [1, 1.5, 2, 3.12]) {
        const body = RAMP.body[0] * scale * Math.min(system, BODY_MAX_FONT_SCALE);
        for (const variant of ['display', 'title1', 'title2', 'title3'] as const)
            expect(RAMP[variant][0] * scale * Math.min(system, fontScaleCap(variant))).toBeGreaterThan(body);
    }
});
test('Create reserves complete-word space and switches to one column at AX5', () => {
    expect(createTileColumns(430, 1)).toBe(2);
    expect(createTileColumns(430, 3.12)).toBe(1);
    expect(createTileColumns(390, 3.12, 1.25)).toBe(1);
    expect(createTileColumns(1024, 3.12)).toBe(2);
});
const containers = [
    ['app/(app)/(tabs)/index.tsx', 4], ['app/(app)/create/[modelId].tsx', 1],
    ['app/(app)/create/agent.tsx', 1], ['app/(app)/chat/persona/[id].tsx', 1],
    ['app/(app)/chat/[id].tsx', 1], ['app/(app)/chat/folders.tsx', 1],
    ['components/KeyboardFormScrollView.tsx', 1], ['components/chat/ChatComposerDeck.tsx', 2], ['components/chat/AttachStrip.tsx', 1],
] as const;
test.each(containers)('%s: each scroll responder preserves handled taps', (file, count) => {
    const tree = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let found = 0;
    function visit(node: ts.Node) {
        if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ['ScrollView', 'FlatList', 'KeyboardFormScrollView'].includes(node.tagName.getText(tree))) {
            found++;
            const props = node.attributes.properties.filter(p => ts.isJsxAttribute(p) && p.name.getText(tree) === 'keyboardShouldPersistTaps');
            expect(props).toHaveLength(1);
            expect((props[0] as ts.JsxAttribute).initializer?.getText(tree)).toBe('"handled"');
        }
        ts.forEachChild(node, visit);
    }
    visit(tree);
    expect(found).toBe(count);
});
test('HTTP Turnstile is restricted to exactly the configured loopback origin in development', () => {
    const local = 'http://localhost:8799';
    expect(turnstileOrigins(local, true)).toContain(local);
    expect(turnstileOrigins(local, false)).not.toContain(local);
    expect(allowTurnstileNavigation(local + '/', local, true)).toBe(true);
    for (const url of [local, local + '/challenge']) expect(allowTurnstileNavigation(url, local, false)).toBe(false);
    for (const url of ['http://localhost:8800', 'http://localhost.evil.test:8799', 'http://example.com', 'javascript:alert(1)'])
        expect(allowTurnstileNavigation(url, local, true)).toBe(false);
    expect(turnstileOrigins('http://example.com', true)).toEqual(['https://*', 'about:*']);
    expect(allowTurnstileNavigation('https://challenges.cloudflare.com/challenge', 'https://veyrnox.ai')).toBe(true);
});

test.each(['welcome', 'start', 'vibe'])('%s is headerless in the parent stack and the screen', route => {
    const layout = source('app/(app)/_layout.tsx');
    const tree = ts.createSourceFile('_layout.tsx', layout, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const screens: ts.JsxSelfClosingElement[] = [];
    function visit(node: ts.Node) {
        if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === 'Stack.Screen' &&
            node.attributes.properties.some(p => ts.isJsxAttribute(p) && p.name.getText(tree) === 'name' && p.initializer?.getText(tree) === JSON.stringify(route))) screens.push(node);
        ts.forEachChild(node, visit);
    }
    visit(tree);
    expect(screens).toHaveLength(1);
    expect(screens[0].getText(tree)).toContain('headerShown: false');
    expect(source(`app/(app)/${route}.tsx`)).toContain('headerShown: false');
});
