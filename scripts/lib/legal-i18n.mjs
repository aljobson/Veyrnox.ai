import ts from 'typescript';
import { BINDINGS } from '../../lib/i18n/legal/binding.mjs';

const normalize = text => text.replace(/\s+/g, ' ').trim();
const decode = text => text.replace(/&(?:amp|apos|quot|lt|gt|ldquo|rdquo|lsquo|rsquo);/g,
  value => ({ '&amp;': '&', '&apos;': "'", '&quot;': '"', '&lt;': '<', '&gt;': '>', '&ldquo;': '“', '&rdquo;': '”', '&lsquo;': '‘', '&rsquo;': '’' })[value]);

// Recognise paired English/translated declarations, not a list of exempt prose.
// A missing id, changed English wording or unknown interpolation stays unresolved.
export function bindingInventory(tree) {
  const declarations = new Map(), paired = new Map(), used = new Set();
  function constants(node) {
    if (ts.isVariableDeclaration(node) && node.initializer) declarations.set(node.name.getText(tree), node);
    ts.forEachChild(node, constants);
  }
  constants(tree);
  function scan(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === 'BindingText') {
      const attrs = node.openingElement.attributes.properties;
      const id = attrs.find(attr => attr.name?.text === 'id')?.initializer?.text;
      const values = attrs.find(attr => attr.name?.text === 'values')?.initializer?.expression;
      const expressions = new Map((values?.properties || []).map(property => [property.initializer.getText(tree).replace(/\s/g, ''), property.name.getText(tree)]));
      const referenced = new Set();
      function text(child) {
        if (ts.isJsxText(child)) return decode(child.text);
        if (ts.isJsxExpression(child)) {
          const expression = child.expression;
          if (!expression) return '';
          if (ts.isStringLiteral(expression)) return expression.text;
          const slot = expressions.get(expression.getText(tree).replace(/\s/g, ''));
          if (slot) return `{${slot}}`;
          const declaration = declarations.get(expression.getText(tree));
          if (declaration && ts.isStringLiteral(declaration.initializer)) { referenced.add(declaration); return declaration.initializer.text; }
          return '\u0000';
        }
        if (ts.isJsxElement(child)) {
          if (child.openingElement.tagName.getText(tree) === 'a') return '{policy}';
          return child.children.map(text).join('');
        }
        return '\u0000';
      }
      const english = normalize(node.children.map(text).join(''));
      const valid = typeof BINDINGS.en[id] === 'string' && english === normalize(BINDINGS.en[id]) && Object.values(BINDINGS).every(messages => typeof messages[id] === 'string');
      paired.set(node, { id, valid });
      if (valid) referenced.forEach(declaration => used.add(declaration));
    }
    ts.forEachChild(node, scan);
  }
  scan(tree);
  return { paired, used };
}
