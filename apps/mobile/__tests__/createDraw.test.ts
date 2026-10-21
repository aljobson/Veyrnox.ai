declare const __dirname: string;
const { readFileSync } = require('fs') as { readFileSync: (path: string, encoding: string) => string };
const { resolve } = require('path') as { resolve: (...paths: string[]) => string };
import ts from 'typescript';
import { canDraw } from '../src/lib/drawOnImage';
import type { CatalogModel } from '../src/lib/media';

// Inspect the real JSX prop and evaluate it for catalog/slot combinations without mocking Create's billing hooks.
test('Create wires drawable only to the eligible image SourcePicker', () => {
    const source = readFileSync(resolve(__dirname, '../src/app/(app)/create/[modelId].tsx'), 'utf8');
    const tree = ts.createSourceFile('create.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const expressions: string[] = [];
    function visit(node: ts.Node) {
        if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === 'SourcePicker') {
            const attribute = node.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(tree) === 'drawable') as ts.JsxAttribute;
            expect(attribute).toBeDefined();
            expressions.push((attribute.initializer as ts.JsxExpression).expression!.getText(tree));
        }
        ts.forEachChild(node, visit);
    }
    visit(tree);
    expect(expressions).toHaveLength(1);
    const value = new Function('canDraw', 'model', 's', `return (${expressions[0]});`);
    const model: CatalogModel = { id: 'edit', name: 'Edit', modality: 'image', credits: 1, gated: false, durations: [], capabilities: { inputs: { prompt: {} }, media: { image: {}, endImage: {} } } };
    expect(value(canDraw, model, { slot: 'image' })).toBe(true);
    for (const slot of ['endImage', 'video', 'audio']) expect(value(canDraw, model, { slot })).toBe(false);
    expect(value(canDraw, { ...model, modality: 'video' }, { slot: 'image' })).toBe(false);
    expect(value(canDraw, { ...model, capabilities: { media: { image: {} } } }, { slot: 'image' })).toBe(false);
});
