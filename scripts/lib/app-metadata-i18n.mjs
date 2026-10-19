import ts from 'typescript';

export const appMetadataFile = file => /^app\/veyrnox\/app\/(?!admin(?:\/|$))/.test(file);

export function isMetadataExport(node) {
  if (!node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) return false;
  return (ts.isFunctionDeclaration(node) && node.name?.text === 'generateMetadata')
    || (ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => ['metadata', 'generateMetadata'].includes(declaration.name.getText())));
}

// Follow local bindings so a title returned via a variable is still inventoried.
// Only display fields are copy; canonical URLs, robots and image paths are data.
export function inventoryMetadata(node, tree, english, add) {
  const bindings = new Map();
  function collect(current) {
    if (ts.isVariableDeclaration(current) && current.initializer) bindings.set(current.name.getText(tree), current.initializer);
    if (current !== node && ts.isFunctionLike(current)) return;
    ts.forEachChild(current, collect);
  }
  tree.statements.filter(ts.isVariableStatement).forEach(collect);
  collect(node);
  const visiting = new Set();
  function visit(current, copy = false) {
    if (!current || visiting.has(current)) return;
    visiting.add(current);
    inspect(current, copy);
    visiting.delete(current);
  }
  function inspect(current, copy) {
    if (ts.isIdentifier(current)) { visit(bindings.get(current.text), copy); return; }
    if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
      if (!copy) return;
      const brand = ['%s — Veyrnox.ai', ' — Veyrnox.ai'].includes(current.text);
      add(current, 'metadata', current.text, brand ? 'allowlisted' : 'unresolved', brand ? 'unchanged brand suffix/template' : 'metadata literal needs a catalog lookup');
      return;
    }
    if (ts.isTemplateExpression(current)) {
      if (copy) {
        for (const literal of [current.head, ...current.templateSpans.map(span => span.literal)]) {
          if (!literal.text.trim()) continue;
          const brand = literal.text === ' — Veyrnox.ai';
          add(literal, 'metadata', literal.text, brand ? 'allowlisted' : 'unresolved', brand ? 'unchanged brand suffix/template' : 'metadata template contains untranslated copy');
        }
      }
      current.templateSpans.forEach(span => visit(span.expression, copy));
      return;
    }
    if (ts.isCallExpression(current) && ['t', 'tOr'].includes(current.expression.getText(tree))) {
      const fallbackCall = current.expression.getText(tree) === 'tOr';
      const key = current.arguments[fallbackCall ? 1 : 0];
      const value = key && ts.isStringLiteral(key) ? english[key.text] : undefined;
      add(key || current, 'metadata-lookup', key?.text || current.getText(tree), value ? 'translated' : 'unresolved', value ? undefined : 'missing English metadata key');
      if (fallbackCall) {
        const fallback = current.arguments[2];
        if (!fallback || !(ts.isStringLiteral(fallback) || ts.isNoSubstitutionTemplateLiteral(fallback)) || fallback.text !== value) {
          add(fallback || current, 'metadata-fallback', fallback?.text || current.getText(tree), 'unresolved', 'metadata fallback must equal its English catalog value');
        }
      }
      current.arguments.slice(fallbackCall ? 3 : 1).forEach(argument => visit(argument, true));
      return;
    }
    if (ts.isObjectLiteralExpression(current)) {
      for (const property of current.properties) {
        if (ts.isSpreadAssignment(property)) { visit(property.expression, copy); continue; }
        const name = property.name?.text;
        const value = ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer;
        if (['title', 'description', 'default', 'absolute', 'template'].includes(name)) visit(value, true);
        else if (['openGraph', 'twitter'].includes(name)) visit(value);
      }
      return;
    }
    if (ts.isConditionalExpression(current)) {
      visit(current.whenTrue, copy); visit(current.whenFalse, copy); return;
    }
    if (ts.isFunctionDeclaration(current) || ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
      collect(current.body);
      if (!ts.isBlock(current.body)) { visit(current.body); return; }
      function returns(child) {
        if (ts.isReturnStatement(child)) visit(child.expression);
        else if (!ts.isFunctionLike(child)) ts.forEachChild(child, returns);
      }
      ts.forEachChild(current.body, returns);
      return;
    }
    if (ts.isVariableStatement(current)) {
      current.declarationList.declarations.forEach(declaration => visit(declaration.initializer));
      return;
    }
    ts.forEachChild(current, child => visit(child, copy));
  }
  visit(node);
}
