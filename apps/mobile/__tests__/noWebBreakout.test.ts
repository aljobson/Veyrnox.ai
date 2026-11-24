import ts from 'typescript-legacy';
declare const require: (id: string) => any;
declare const __dirname: string;
const { readFileSync, readdirSync } = require('fs');
const { join } = require('path');
const root = join(__dirname, '../src');
// WebViews are exceptional native boundaries. Keep this list exact so a new import cannot silently turn a native
// feature into a hosted page. The B1 harness is a build-gated diagnostic, not a user-facing route.
const allowedWebViews: Record<string, string> = {
    'auth/TurnstileView.tsx': 'Cloudflare Turnstile has no native challenge SDK.',
    'components/cinema/YouTubeEmbed.tsx': 'YouTube requires its policy-controlled embedded player.',
    'components/dev/BeatEngineSpikeHarness.tsx': 'Build-gated audio-engine diagnostic; never reachable in an ordinary release.',
};
// Exact files AND arguments: another browser call in an allowed file still fails.
const allowed: Record<string, { call: string; reason: string }[]> = {
    'auth/AuthProvider.tsx': [{ call: 'openAuthSessionAsync', reason: 'System OAuth login must use the provider authentication session.' }],
    'app/(app)/publish/connect.tsx': [{ call: 'openAuthSessionAsync', reason: 'Social providers require an external OAuth session.' }],
    'app/(app)/oauth-consent.tsx': [{ call: 'openURL(target)', reason: 'OAuth hands the authorization result back to the requesting app.' }],
    'app/(app)/account.tsx': [
        { call: 'openURL(managementURL)', reason: 'Apple/Google subscription management belongs to the store.' },
        { call: 'openURL(`mailto:${SUPPORT_EMAIL}`)', reason: 'Contact support in the mail app; the scheme is fixed.' },
        { call: 'openSettings()', reason: 'Opens this app\'s own page in the phone settings so a denied notification permission can be changed; it is not a web page.' },
    ],
    'app/(app)/credits.tsx': [{ call: 'openBrowserAsync(billing.managementURLasstring)', reason: 'Apple/Google subscription management belongs to the store.' }],
    'app/(app)/paywall.tsx': [{ call: 'openBrowserAsync(managementURL)', reason: 'Apple/Google subscription management belongs to the store.' }],
    'app/(app)/help.tsx': [{ call: 'openURL(`mailto:${SUPPORT_EMAIL}`)', reason: 'Contact support in the mail app; the scheme is fixed.' }],
    'app/(app)/privacy-export.tsx': [{ call: 'openURL(`mailto:${PRIVACY_EMAIL}?subject=${encodeURIComponent(MAIL_SUBJECT)}`)', reason: 'Ask privacy in the mail app; the scheme is fixed and the subject is constant text.' }],
    'app/(app)/about.tsx': [{ call: 'openURL(`mailto:${LEGAL_EMAIL}`)', reason: 'Contact legal in the mail app; the scheme is fixed.' }],
    'components/beats/BeatRecordPanel.tsx': [{ call: 'openSettings()', reason: 'Opens this app\'s own page in the phone settings so a denied microphone permission can be changed; it is not a web page.' }],
    'components/cinema/creator/UploadPanel.tsx': [{ call: 'openURL(SUPPORT_MAIL_URL)', reason: 'Creator support uses the existing mailto support constant.' }],
    'components/account/MfaCard.tsx': [{ call: 'openURL(pending.uri)', reason: 'The existing isTotpUri gate allows only otpauth TOTP enrollment.' }],
    'components/templates/SwapAttemptStatus.tsx': [{ call: 'openURL(`mailto:${SUPPORT_EMAIL}`)', reason: 'Contact support in the mail app about an unresolved swap run; the scheme is fixed.' }],
    'components/legal/LegalDocumentView.tsx': [{ call: 'openURL(target.href)', reason: 'legalLink classifies only mailto addresses as mail; other addresses are inert.' }],
    'components/paywall/PaywallSheet.tsx': [{ call: 'openBrowserAsync(billing.managementURLasstring)', reason: 'Apple/Google subscription management belongs to the store.' }],
    'components/editor/assetPacks/AssetPackLibrarySheet.tsx': [{ call: 'openURL(selected.attribution.url)', reason: 'A validated local asset manifest may carry an optional HTTPS source or licence URL which the user explicitly chooses to inspect.' }],
};
function calls(source: string) {
    const file = ts.createSourceFile('screen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const found: string[] = [];
    const methods = new Set(['openBrowserAsync', 'openAuthSessionAsync', 'openURL', 'openSettings']);
    function visit(node: ts.Node) {
        if (ts.isCallExpression(node)) {
            const callee = node.expression;
            const name = ts.isPropertyAccessExpression(callee) ? callee.name.text
                : ts.isElementAccessExpression(callee) && ts.isStringLiteral(callee.argumentExpression) ? callee.argumentExpression.text
                : ts.isIdentifier(callee) ? callee.text : '';
            if (methods.has(name)) found.push(name === 'openAuthSessionAsync' ? name : `${name}(${node.arguments.map(a => a.getText(file).replace(/\s/g, '')).join(',')})`);
        }
        ts.forEachChild(node, visit);
    }
    visit(file);
    return found;
}
function files(dir: string, prefix = ''): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry: any) => entry.isDirectory()
        ? files(join(dir, entry.name), prefix + entry.name + '/') : /\.(?:[jt]sx?|[cm]js)$/.test(entry.name) ? [prefix + entry.name] : []);
}
type WebViewLoad = 'import' | 'import-equals' | 'require' | 'dynamic-import' | 'export-from';
const genericWebViewInputs = new Set(['source', 'uri', 'url']);
function sourceFile(source: string) {
    return ts.createSourceFile('screen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
function webViewTarget(node: ts.Expression | undefined) {
    return !!node && ts.isStringLiteralLike(node) && /^react-native-webview(?:\/|$)/.test(node.text);
}
function webViewLoads(source: string): WebViewLoad[] {
    const file = sourceFile(source);
    const found: WebViewLoad[] = [];
    function visit(node: ts.Node) {
        if (ts.isImportDeclaration(node) && webViewTarget(node.moduleSpecifier)) found.push('import');
        else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
            && webViewTarget(node.moduleReference.expression)) found.push('import-equals');
        else if (ts.isExportDeclaration(node) && webViewTarget(node.moduleSpecifier)) found.push('export-from');
        else if (ts.isCallExpression(node) && webViewTarget(node.arguments[0])) {
            if (ts.isIdentifier(node.expression) && node.expression.text === 'require') found.push('require');
            else if (node.expression.kind === ts.SyntaxKind.ImportKeyword) found.push('dynamic-import');
        }
        ts.forEachChild(node, visit);
    }
    visit(file);
    return found;
}
function webViewSpecifiers(source: string) {
    const file = sourceFile(source);
    const found: string[] = [];
    function add(node: ts.Expression | undefined) { if (node && ts.isStringLiteralLike(node) && webViewTarget(node)) found.push(node.text); }
    function visit(node: ts.Node) {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
        else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) add(node.moduleReference.expression);
        else if (ts.isCallExpression(node)) add(node.arguments[0]);
        ts.forEachChild(node, visit);
    }
    visit(file);
    return found;
}
function importedWebViewBindings(file: ts.SourceFile) {
    const bindings = new Set<string>();
    for (const statement of file.statements) {
        if (ts.isImportDeclaration(statement) && webViewTarget(statement.moduleSpecifier)) {
            const clause = statement.importClause;
            if (clause?.name) bindings.add(clause.name.text);
            if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) bindings.add(clause.namedBindings.name.text);
            else if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
                clause.namedBindings.elements.forEach(element => bindings.add(element.name.text));
            }
        } else if (ts.isImportEqualsDeclaration(statement) && ts.isExternalModuleReference(statement.moduleReference)
            && webViewTarget(statement.moduleReference.expression)) bindings.add(statement.name.text);
    }
    return bindings;
}
function reExportedWebViewBindings(source: string) {
    const file = sourceFile(source);
    const imported = importedWebViewBindings(file);
    const found = new Set<string>();
    for (const statement of file.statements) {
        if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
            for (const element of statement.exportClause.elements) {
                const local = (element.propertyName ?? element.name).text;
                if (imported.has(local)) found.add(local);
            }
        } else if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression) && imported.has(statement.expression.text)) {
            found.add(statement.expression.text);
        } else if (ts.isVariableStatement(statement) && statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
            for (const declaration of statement.declarationList.declarations) {
                if (declaration.initializer && ts.isIdentifier(declaration.initializer) && imported.has(declaration.initializer.text)) {
                    found.add(declaration.initializer.text);
                }
            }
        }
    }
    return [...found].sort();
}
function genericWrapperInputs(source: string) {
    const file = sourceFile(source);
    const namedTypes = new Map<string, readonly ts.TypeElement[]>();
    for (const statement of file.statements) {
        if (ts.isInterfaceDeclaration(statement)) namedTypes.set(statement.name.text, statement.members);
        else if (ts.isTypeAliasDeclaration(statement) && ts.isTypeLiteralNode(statement.type)) namedTypes.set(statement.name.text, statement.type.members);
    }
    const found = new Set<string>();
    const addName = (name: ts.PropertyName | ts.BindingName | undefined) => {
        if (!name) return;
        if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) {
            if (genericWebViewInputs.has(name.text)) found.add(name.text);
        } else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
            name.elements.forEach(element => { if (ts.isBindingElement(element)) addName(element.name); });
        }
    };
    const addMembers = (members: readonly ts.TypeElement[]) => members.forEach(member => {
        if (ts.isPropertySignature(member) || ts.isMethodSignature(member)) addName(member.name);
    });
    const addType = (type: ts.TypeNode | undefined) => {
        if (!type) return;
        if (ts.isTypeLiteralNode(type)) addMembers(type.members);
        else if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) addMembers(namedTypes.get(type.typeName.text) ?? []);
        else if (ts.isUnionTypeNode(type) || ts.isIntersectionTypeNode(type)) type.types.forEach(addType);
    };
    const addParameter = (parameter: ts.ParameterDeclaration) => { addName(parameter.name); addType(parameter.type); };
    const addCallable = (node: ts.Expression | undefined) => {
        if (!node) return;
        if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) node.parameters.forEach(addParameter);
        else if (ts.isCallExpression(node)) {
            node.typeArguments?.forEach(addType);
            node.arguments.forEach(argument => {
                if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) argument.parameters.forEach(addParameter);
            });
        }
    };
    const exported = (node: { modifiers?: ts.NodeArray<ts.ModifierLike> }) => node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
    for (const statement of file.statements) {
        if (ts.isFunctionDeclaration(statement) && exported(statement)) statement.parameters.forEach(addParameter);
        else if (ts.isVariableStatement(statement) && exported(statement)) {
            statement.declarationList.declarations.forEach(declaration => addCallable(declaration.initializer));
        } else if (ts.isExportAssignment(statement)) addCallable(statement.expression);
    }
    return [...found].sort();
}
test('every external call has an explicit system-flow exception, with no unused exceptions', () => {
    const found: Record<string, string[]> = {};
    for (const file of files(root)) {
        const matches = calls(readFileSync(join(root, file), 'utf8'));
        if (matches.length) found[file] = matches.sort();
    }
    expect(found).toEqual(Object.fromEntries(Object.entries(allowed).map(([file, entries]) => [file, entries.map(e => e.call).sort()])));
    for (const entries of Object.values(allowed)) entries.forEach(e => expect(e.reason.length).toBeGreaterThan(20));
});
test('only the exact native-boundary allowlist directly imports react-native-webview', () => {
    const found = files(root).filter(file => webViewLoads(readFileSync(join(root, file), 'utf8')).length > 0).sort();
    expect(found).toEqual(Object.keys(allowedWebViews).sort());
    for (const [file, reason] of Object.entries(allowedWebViews)) {
        expect(reason.length).toBeGreaterThan(20);
        // An allowlisted boundary owns its WebView directly. It may not become a generic re-export that lets any
        // caller bypass this file-level review.
        const source = readFileSync(join(root, file), 'utf8');
        expect(webViewLoads(source)).toEqual(['import']);
        expect(webViewSpecifiers(source)).toEqual(['react-native-webview']);
        expect(reExportedWebViewBindings(source)).toEqual([]);
        expect(genericWrapperInputs(source)).toEqual([]);
    }
    const route = readFileSync(join(root, 'app/(app)/dev-b1-beat.tsx'), 'utf8');
    expect(route).toContain('process.env.EXPO_PUBLIC_DEV_B1_BEAT_SPIKE');
    expect(route).toContain("if (!on && !__DEV__) return <Redirect href=\"/\" />");
});
test.each([
    ["import { WebView } from 'react-native-webview';", ['import']],
    ["const webview = require('react-native-webview');", ['require']],
    ["const webview = import('react-native-webview');", ['dynamic-import']],
    ["export * from 'react-native-webview';", ['export-from']],
    ["import WebView = require('react-native-webview');", ['import-equals']],
    ['const webview = require(`react-native-webview`);', ['require']],
    ['const webview = import(`react-native-webview`);', ['dynamic-import']],
    ["import { WebView } from 'react-native-webview/lib/WebView';", ['import']],
    ["const webview = require('react-native-webview/lib/WebView');", ['require']],
    ["const webview = import('react-native-webview/lib/WebView');", ['dynamic-import']],
    ["export * from 'react-native-webview/lib/WebView';", ['export-from']],
    ["import WebView = require('react-native-webview/lib/WebView');", ['import-equals']],
    ['const webview = require(`react-native-webview/lib/WebView`);', ['require']],
    ['const webview = import(`react-native-webview/lib/WebView`);', ['dynamic-import']],
] as const)('WebView scanner catches alternate module loading: %s', (source, expected) => {
    expect(webViewLoads(source)).toEqual(expected);
});
test('WebView source inventory includes CommonJS and ES module script extensions', () => {
    expect(['boundary.js', 'boundary.jsx', 'boundary.ts', 'boundary.tsx', 'boundary.cjs', 'boundary.mjs']
        .every(name => /\.(?:[jt]sx?|[cm]js)$/.test(name))).toBe(true);
});
test('an allowlisted file cannot hide a generic WebView re-export beside its direct import', () => {
    const source = "import { WebView } from 'react-native-webview'; export * from 'react-native-webview';";
    expect(webViewLoads(source)).toEqual(['import', 'export-from']);
    expect(webViewLoads(source)).not.toEqual(['import']);
});
test.each([
    "import { WebView } from 'react-native-webview'; export { WebView };",
    "import { WebView as NativeWebView } from 'react-native-webview'; export { NativeWebView as WebView };",
    "import WebView from 'react-native-webview'; export default WebView;",
    "import WebView from 'react-native-webview'; export const GenericWebView = WebView;",
])('allowlisted modules cannot re-export their imported WebView binding: %s', source => {
    expect(reExportedWebViewBindings(source).length).toBeGreaterThan(0);
});
test.each([
    'export function Generic({ url }: { url: string }) { return null; }',
    'interface Props { uri: string } export function Generic(props: Props) { return null; }',
    'export const Generic = ({ source }: { source: unknown }) => null;',
    'type Props = { url: string }; export const Generic = forwardRef<unknown, Props>(function Generic(props) { return null; });',
])('allowlisted modules cannot expose generic WebView loading inputs: %s', source => {
    expect(genericWrapperInputs(source).length).toBeGreaterThan(0);
});
test('mail and authenticator exceptions retain scheme guards', () => {
    const read = (path: string) => readFileSync(join(root, path), 'utf8');
    expect(read('components/cinema/creator/UploadPanel.tsx')).toContain('SUPPORT_MAIL_URL = `mailto:${SUPPORT_EMAIL}`');
    expect(read('components/account/MfaCard.tsx')).toContain('isTotpUri(pending.uri) ?');
    expect(read('components/legal/LegalDocumentView.tsx')).toContain("if (target.kind === 'plain') return");
    expect(read('components/legal/LegalDocumentView.tsx')).toContain("target.kind === 'legal' ? onNavigate");
});
test('scanner catches browser, authentication, settings and URL calls', () => {
    expect(calls("WebBrowser.openBrowserAsync(url); Linking.openSettings(); Linking['openURL'](uri); openAuthSessionAsync(a,b)"))
        .toEqual(['openBrowserAsync(url)', 'openSettings()', 'openURL(uri)', 'openAuthSessionAsync']);
});
