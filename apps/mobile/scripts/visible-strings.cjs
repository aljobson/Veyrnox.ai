// Deliberately inspect syntax, including ternaries/templates, instead of grepping source lines.
const ts = require('typescript');
const props = new Set(['alt', 'accessibilityLabel', 'accessibilityHint', 'placeholder', 'label', 'title', 'subtitle', 'detail', 'description', 'hint', 'body', 'action', 'emptyText', 'errorMessage', 'confirmLabel', 'cancelLabel']);
// Product/brand names and established font names retain their spelling in every language.
// T and CC are the existing editor's text/captions glyphs.
const glyphs = new Set(['T', 'CC']);
const brands = new Set(['Veyrnox.ai', 'Veyrnox', 'Vey', 'Apple', 'Google', 'OpenCut', 'YouTube', 'TikTok', 'Instagram', 'Facebook', 'LinkedIn', 'X', 'Threads', 'Pinterest', 'Bluesky', 'Google Business Profile']);
function visibleStrings(source, filename = 'screen.tsx', { objectKeys = [] } = {}) {
    const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const found = [];
    const report = (node, value, allowed = []) => {
        const text = value.trim();
        if (!allowed.includes(text) && /[A-Za-z]/.test(text) && !brands.has(text) && !glyphs.has(text)) found.push({ line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1, text });
    };
    const expression = (node, allowed = []) => {
        if (!node) return;
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) report(node, node.text, allowed);
        else if (ts.isTemplateExpression(node)) {
            report(node, node.head.text + node.templateSpans.map(s => s.literal.text).join(''), allowed);
            node.templateSpans.forEach(s => expression(s.expression, allowed));
        } else if (ts.isConditionalExpression(node)) { expression(node.whenTrue, allowed); expression(node.whenFalse, allowed); }
        else if (ts.isBinaryExpression(node)) {
            if (node.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) expression(node.left, allowed);
            expression(node.right, allowed);
        } else if (ts.isParenthesizedExpression(node)) expression(node.expression, allowed);
        // Calls/identifiers are checked at their definitions by the source audit, not mistaken for English keys.
    };
    function visit(node) {
        if (ts.isJsxText(node)) report(node, node.text);
        if (ts.isJsxAttribute(node) && props.has(node.name.getText(ast))) {
            const init = node.initializer;
            if (init && ts.isStringLiteral(init)) report(init, init.text);
            else if (init && ts.isJsxExpression(init)) expression(init.expression);
        }
        if (ts.isJsxExpression(node) && ts.isJsxElement(node.parent)) expression(node.expression);
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
            && node.expression.expression.getText(ast) === 'Alert' && node.expression.name.text === 'alert') {
            node.arguments.slice(0, 2).forEach(arg => expression(arg));
        }
        if (ts.isPropertyAssignment(node) && ['title', 'text', 'message'].includes(node.name.getText(ast).replace(/^['"]|['"]$/g, ''))) {
            expression(node.initializer, objectKeys);
        }
        ts.forEachChild(node, visit);
    }
    visit(ast);
    return found;
}
module.exports = { visibleStrings };
