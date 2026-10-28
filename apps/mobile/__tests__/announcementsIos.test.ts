declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs') as { readdirSync(p: string, options: { withFileTypes: true }): { name: string; isDirectory(): boolean }[]; readFileSync(p: string, encoding: string): string };
const path = require('path') as { join(...parts: string[]): string; relative(from: string, to: string): string };
import ts from 'typescript';

const root = path.join(__dirname, '../src');
function files(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith('.tsx') ? [path.join(dir, e.name)] : []);
}
// Only these specific multi-child messages have a hook owner. Other elements in
// the same file still fail the guard, even if an unrelated hook exists there.
const exceptions: Record<string, { id: string; owner: string; reason: string }> = {
    'app/(app)/editor/[projectId].tsx': { id: 'editor-retry', owner: "useAnnouncement((['offline', 'paused'].includes(session.status) || problem) && !choice ? retryLabel : null)", reason: 'Conditional retry control and its countdown have a mounted hook owner' },
    'components/JobProvenance.tsx': { id: 'provenance-status', owner: 'useAnnouncement(visibleText)', reason: 'One combined announcement of the visible provenance fields' },
    'app/(app)/cinema/[id].tsx': { id: 'cinema-lock', owner: "useAnnouncement(lock && lock !== 'checking'", reason: 'One combined announcement of the lock title and reason' },
};
test.each(files(root).map(file => path.relative(root, file)))('%s has no silent native alert/live region', file => {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const native = new Set<string>(), namespaces = new Set<string>();
    for (const node of ast.statements) {
        if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier) || node.moduleSpecifier.text !== 'react-native') continue;
        const bindings = node.importClause?.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
        if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) {
            if (['Text', 'View'].includes((item.propertyName ?? item.name).text)) native.add(item.name.text);
        }
    }
    const missing: string[] = [];
    function visit(node: ts.Node) {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
            const name = node.tagName.getText(ast);
            if (native.has(name) || [...namespaces].some(ns => name === `${ns}.Text` || name === `${ns}.View`)) {
                const attrs = node.attributes.properties.filter(ts.isJsxAttribute);
                const live = attrs.some(a => a.name.getText(ast) === 'accessibilityLiveRegion' || a.name.getText(ast) === 'accessibilityRole' && a.initializer?.getText(ast).includes('alert'));
                if (live) {
                    const allowed = exceptions[file];
                    const id = attrs.find(a => a.name.getText(ast) === 'testID')?.initializer?.getText(ast);
                    let component: ts.Node | undefined = node.parent;
                    while (component && !ts.isFunctionDeclaration(component) && !ts.isArrowFunction(component)) component = component.parent;
                    if (!allowed || id !== `"${allowed.id}"` || !component?.getText(ast).includes(allowed.owner)) missing.push(node.getText(ast));
                }
            }
        }
        ts.forEachChild(node, visit);
    }
    visit(ast);
    expect(missing).toEqual([]);
});
