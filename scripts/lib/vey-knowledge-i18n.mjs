// Resolve static public copy for the build-time inventory, never execute UI code.
import ts from 'typescript';
import publicEnglish from '../../lib/i18n/messages/en.mjs';
import appEnglish from '../../lib/i18n/messages/app/en.mjs';
const english = { ...publicEnglish, ...appEnglish };

export function resolveI18nSource(source, messages = english, { attributesOnly = false } = {}) {
  const tree = ts.createSourceFile('page.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  const edits = [];
  const escape = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  function text(node) {
    if (!node) return null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) return node.text;
    if (ts.isParenthesizedExpression(node)) return text(node.expression);
    if (ts.isJsxText(node)) return node.text;
    if (ts.isJsxExpression(node)) return text(node.expression);
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const parts = node.children.map(text);
      return parts.every(part => part !== null) ? parts.join('') : null;
    }
    if (!ts.isCallExpression(node)) return null;
    const name = node.expression.getText(tree);
    const [key, vars] = name === 'tOr' ? [node.arguments[1], node.arguments[3]] : node.arguments;
    if (['localize', 'href', 'localizedHref'].includes(name)) {
      return text(node.arguments[name === 'localizedHref' && node.arguments.length > 1 ? 1 : 0]);
    }
    if (name === 'pluralKey') {
      const family = text(node.arguments[2]);
      return family === null ? null : `${family}.other`;
    }
    if (name === 'rich') {
      const message = text(key);
      return message === null ? null : fill(message, vars);
    }
    if (!['tOr', 't', 'translate', 'translation.current', 't.label', 'translate.label'].includes(name)) return null;
    const literal = text(key);
    if (literal === null) return name === 'tOr' ? text(node.arguments[2]) : null;
    const message = messages[name.endsWith('.label') ? `label.${literal}` : literal];
    if (typeof message !== 'string') {
      const fallback = name.endsWith('.label') ? literal : name === 'tOr' ? text(node.arguments[2]) : null;
      return fallback === null ? null : fill(fallback, vars);
    }
    return fill(message, vars);
  }
  function fill(message, vars) {
    const slots = {};
    if (vars && ts.isObjectLiteralExpression(vars)) {
      for (const property of vars.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const value = text(property.initializer);
        if (value !== null) slots[property.name.text] = value;
      }
    }
    return message.replace(/\{(\w+)\}/g, (slot, name) => slots[name] ?? slot);
  }
  function visit(node) {
    if (ts.isJsxExpression(node) && node.expression && (!attributesOnly || ts.isJsxAttribute(node.parent))) {
      const value = text(node.expression);
      if (value !== null) {
        // Encoding braces distinguishes catalog placeholders from unresolvable
        // JavaScript expressions in the inventory's existing JSX text scanner.
        const encoded = escape(value).replaceAll('{', '&#123;').replaceAll('}', '&#125;');
        const attribute = ts.isJsxAttribute(node.parent);
        edits.push({ start: node.getStart(tree), end: node.end, value: attribute ? `"${encoded}"` : encoded });
        return;
      }
    }
    // Conditional JSX and notices keep their JavaScript shape, but static
    // lookups still expose the same English text to the inventory scanner.
    if (!attributesOnly && ts.isCallExpression(node) && ['t', 'tOr', 't.label', 'translate', 'translate.label', 'translation.current'].includes(node.expression.getText(tree))) {
      const value = text(node);
      if (value !== null) {
        edits.push({ start: node.getStart(tree), end: node.end, value: JSON.stringify(value) });
        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.value + source.slice(edit.end);
  return source;
}

// Stable DOM hooks keep their accessible meaning in Vey's inventory. Resolve
// labels from the actual JSX, rather than retaining translated text selectors.
export function controlLabels(source) {
  const resolved = resolveI18nSource(source, undefined, { attributesOnly: true });
  const tree = ts.createSourceFile('controls.jsx', resolved, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  const labels = new Map();
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attrs = Object.fromEntries(node.attributes.properties.filter(attr => ts.isJsxAttribute(attr) && attr.initializer && ts.isStringLiteral(attr.initializer)).map(attr => [attr.name.text, attr.initializer.text]));
      if (attrs['data-testid'] && attrs['aria-label']) labels.set(attrs['data-testid'], attrs['aria-label']);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return labels;
}

export function referencedControlLabels(source, labels) {
  return [...source.matchAll(/\[data-testid=["']([^"']+)["']\]/g)].map(match => labels.get(match[1])).filter(Boolean);
}
