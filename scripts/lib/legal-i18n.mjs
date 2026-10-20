import ts from 'typescript';
import { existsSync, readFileSync } from 'node:fs';
import { BINDINGS } from '../../lib/i18n/legal/binding.mjs';

const manifestURL = new URL('../../lib/i18n/messages/legal/source-hashes.json', import.meta.url);
const manifest = existsSync(manifestURL) ? JSON.parse(readFileSync(manifestURL, 'utf8')) : {};
const normalize = text => text.replace(/\s+/g, ' ').trim();
const decode = text => text.replace(/&(?:amp|apos|quot|lt|gt|ldquo|rdquo|lsquo|rsquo);/g,
  value => ({ '&amp;': '&', '&apos;': "'", '&quot;': '"', '&lt;': '<', '&gt;': '>', '&ldquo;': '“', '&rdquo;': '”', '&lsquo;': '‘', '&rsquo;': '’' })[value]);

// Recognise paired English/translated declarations, not a list of exempt prose.
// A missing id, changed English wording or unknown interpolation stays unresolved.
export function bindingInventory(tree, { checkAnchors = true } = {}) {
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
      const anchors = [];
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
          if (declaration?.initializer.getText(tree) === 'englishBindings.supply' &&
              tree.statements.some(statement => ts.isImportDeclaration(statement) &&
                statement.importClause?.name?.text === 'englishBindings' &&
                statement.moduleSpecifier.text.endsWith('/lib/i18n/messages/legal/en/binding.mjs'))) {
            referenced.add(declaration);
            return BINDINGS.en.supply;
          }
          return '\u0000';
        }
        if (ts.isJsxSelfClosingElement(child) && child.tagName.getText(tree) === 'input') return '';
        if (ts.isJsxElement(child)) {
          if (child.openingElement.tagName.getText(tree) === 'a') {
            const href = child.openingElement.attributes.properties.find(attr => attr.name?.text === 'href')?.initializer;
            anchors.push({ href: href && ts.isStringLiteral(href) ? href.text : null, text: normalize(child.children.map(text).join('')) });
            // The supply label's adjacent refund link is not part of its statement,
            // but its URL and English label are still pinned in the manifest.
            return id === 'supply' ? '' : '{policy}';
          }
          return child.children.map(text).join('');
        }
        return '\u0000';
      }
      const english = normalize(node.children.map(text).join(''));
      const valid = typeof BINDINGS.en[id] === 'string' && english === normalize(BINDINGS.en[id]) &&
        Object.values(BINDINGS).every(messages => typeof messages[id] === 'string') &&
        (!checkAnchors || JSON.stringify(anchors) === JSON.stringify(manifest.anchors?.[id]));
      paired.set(node, { id, valid, anchors });
      if (valid) referenced.forEach(declaration => used.add(declaration));
    }
    ts.forEachChild(node, scan);
  }
  scan(tree);
  return { paired, used };
}
