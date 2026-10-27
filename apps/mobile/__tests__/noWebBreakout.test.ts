import ts from 'typescript';
declare const require: (id: string) => any;
declare const __dirname: string;
const { readFileSync, readdirSync } = require('fs');
const { join } = require('path');
const root = join(__dirname, '../src');
// Exact files AND arguments: another browser call in an allowed file still fails.
const allowed: Record<string, { call: string; reason: string }[]> = {
    'auth/AuthProvider.tsx': [{ call: 'openAuthSessionAsync', reason: 'System OAuth login must use the provider authentication session.' }],
    'app/(app)/publish/connect.tsx': [{ call: 'openAuthSessionAsync', reason: 'Social providers require an external OAuth session.' }],
    'app/(app)/oauth-consent.tsx': [{ call: 'openURL(target)', reason: 'OAuth hands the authorization result back to the requesting app.' }],
    'app/(app)/account.tsx': [
        { call: 'openURL(managementURL)', reason: 'Apple/Google subscription management belongs to the store.' },
        { call: 'openURL(`mailto:${SUPPORT_EMAIL}`)', reason: 'Contact support in the mail app; the scheme is fixed.' },
    ],
    'app/(app)/credits.tsx': [{ call: 'openBrowserAsync(billing.managementURLasstring)', reason: 'Apple/Google subscription management belongs to the store.' }],
    'app/(app)/help.tsx': [{ call: 'openURL(`mailto:${SUPPORT_EMAIL}`)', reason: 'Contact support in the mail app; the scheme is fixed.' }],
    'app/(app)/about.tsx': [{ call: 'openURL(`mailto:${LEGAL_EMAIL}`)', reason: 'Contact legal in the mail app; the scheme is fixed.' }],
    'components/cinema/creator/UploadPanel.tsx': [{ call: 'openURL(SUPPORT_MAIL_URL)', reason: 'Creator support uses the existing mailto support constant.' }],
    'components/account/MfaCard.tsx': [{ call: 'openURL(pending.uri)', reason: 'The existing isTotpUri gate allows only otpauth TOTP enrollment.' }],
    'components/legal/LegalDocumentView.tsx': [{ call: 'openURL(target.href)', reason: 'legalLink classifies only mailto addresses as mail; other addresses are inert.' }],
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
        ? files(join(dir, entry.name), prefix + entry.name + '/') : /\.[jt]sx?$/.test(entry.name) ? [prefix + entry.name] : []);
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
