import { INSTALL_KEPT_KEYS, INSTALL_RESET_KEYS } from '../src/lib/installReset';
const ts = require('typescript') as typeof import('typescript');
declare const __dirname: string;
const fs = require('node:fs');
const path = require('node:path');

// Resolve imported constants and constant template strings, rather than grep only string literals
// at call sites. Unresolved expressions must be reviewed explicitly, so new dynamic keys fail too.
test('every fixed SecureStore key is reset or kept with a reason', () => {
    const root = path.resolve(__dirname, '../src');
    const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e: { isDirectory: () => boolean; name: string }) =>
        e.isDirectory() ? files(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []);
    const program = ts.createProgram(files(root), { target: ts.ScriptTarget.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX });
    const checker = program.getTypeChecker();
    function constant(node: import('typescript').Node, depth = 0): string | undefined {
        if (depth > 15) return undefined;
        if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text;
        if (ts.isTemplateExpression(node)) {
            let value = node.head.text;
            for (const span of node.templateSpans) {
                const part = constant(span.expression, depth + 1);
                if (part === undefined) return undefined;
                value += part + span.literal.text;
            }
            return value;
        }
        if (ts.isIdentifier(node)) {
            let symbol = checker.getSymbolAtLocation(node);
            if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
            const declaration = symbol?.valueDeclaration;
            if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) return constant(declaration.initializer, depth + 1);
        }
        return undefined;
    }
    const dynamic: Record<string, string> = {
        'theme.ts:key': 'Generic theme read/save adapters; concrete callers scanned below.',
        'theme.ts:`veyrnox.${key}`': 'AppearanceSettings loop; fixed keys also read individually.',
        'lib/celebrate.ts:key': 'Generic read/write adapters; concrete callers scanned below.',
        'lib/aiConsentStore.ts:key': 'Per-user AI consent adapter.',
        'components/PaywallPrompt.tsx:seenKey(owner)': 'Per-user paywall seen flag.',
        'components/PaywallPrompt.tsx:depletedKey(owner)': 'Per-user paywall depleted flag.',
        'lib/mfaCheck.ts:key': 'Per-install, per-user MFA enrolment.',
    };
    const found = new Set<string>();
    const unknown: string[] = [];
    for (const source of program.getSourceFiles()) {
        if (!source.fileName.startsWith(root + path.sep)) continue;
        const relative = path.relative(root, source.fileName);
        if (relative === 'lib/installReset.ts') continue;
        function visit(node: import('typescript').Node) {
            if (ts.isCallExpression(node)) {
                const call = node.expression.getText(source);
                // Resolve the declaration as well: aliases such as store.deleteItemAsync and
                // injected adapters such as Oddlings' secure.get/set still call SecureStore.
                const declaration = checker.getResolvedSignature(node)?.declaration;
                const secure = /(?:SecureStore|secureStore\(\))\??\.(?:getItem|setItem|deleteItem)(?:Async)?$/.test(call) ||
                    !!declaration?.getSourceFile().fileName.includes('/expo-secure-store/');
                const wrapper = (relative === 'theme.ts' && ['read', 'save'].includes(call)) ||
                    (relative === 'lib/celebrate.ts' && ['read', 'write'].includes(call));
                if ((secure || wrapper) && node.arguments[0]) {
                    const expression = node.arguments[0];
                    const value = constant(expression);
                    if (value !== undefined) found.add(value);
                    else if (!dynamic[`${relative}:${expression.getText(source)}`]) unknown.push(`${relative}:${expression.getText(source)}`);
                }
            }
            ts.forEachChild(node, visit);
        }
        visit(source);
    }
    expect(unknown).toEqual([]);
    const covered = [...INSTALL_RESET_KEYS, ...Object.keys(INSTALL_KEPT_KEYS)];
    expect([...found].filter(key => !covered.includes(key))).toEqual([]);
    expect([...found].sort()).toEqual([...covered].sort());
    expect(Object.values(INSTALL_KEPT_KEYS).every(reason => reason.length > 10)).toBe(true);
}, 30_000);

test('custom entry runs reset before router; layout flushes immediately after crash init', () => {
    expect(require('../package.json').main).toBe('index.js');
    const entry = fs.readFileSync(path.resolve(__dirname, '../index.js'), 'utf8');
    expect(entry.trim().split('\n')).toEqual(["require('./src/lib/installReset').resetInstall();", "require('expo-router/entry');"]);
    const layout = fs.readFileSync(path.resolve(__dirname, '../src/app/_layout.tsx'), 'utf8');
    expect(layout.split('\n')[0]).toBe("import { flushInstallResetIssue } from '../lib/installReset';");
    expect(layout).toContain('if (initCrashReporting()) flushInstallResetIssue(captureIssue);');
});

test('existing push token conflict moves ownership to the signed-in account', () => {
    const sql = fs.readFileSync(path.resolve(__dirname, '../../../packages/db/schema/supabase/0348_push_tokens.sql'), 'utf8');
    expect(sql).toMatch(/ON CONFLICT \(token\) DO UPDATE\s+SET user_id = EXCLUDED.user_id/);
});
