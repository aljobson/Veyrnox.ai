// Exported data and the local constant/factory dependencies that supply it.
import ts from 'typescript';
import { helperDiagnostic } from '../../lib/helperMessages.mjs';
import { PRESET_STEP_KEYS } from '../../lib/i18n/presetSteps.mjs';
import { dataException } from './data-i18n-exceptions.mjs';

function literal(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = literal(node.left), right = literal(node.right);
    if (left !== undefined && right !== undefined) return left + right;
  }
}

export function dataInventory(tree, file, english) {
  if (!/^(?:app\/veyrnox\/_lib\/|lib\/|components\/)/.test(file) || /^lib\/i18n\//.test(file)) return [];
  const rows = [], declarations = new Map(), factories = new Map(), visited = new Set();
  const values = new Set(Object.values(english));
  const templateFile = /\/(?:sourceTemplateExpansion\d*|sourceTemplates|originalTemplates|templates)\.js$/.test(file);
  for (const statement of tree.statements) {
    if (ts.isVariableStatement(statement) && statement.declarationList.flags & ts.NodeFlags.Const) {
      for (const declaration of statement.declarationList.declarations) declarations.set(declaration.name.getText(tree), declaration);
    }
    if (ts.isFunctionDeclaration(statement) && statement.name) factories.set(statement.name.text, statement);
  }
  function dependencies(node) {
    if (ts.isIdentifier(node)) {
      if (declarations.has(node.text)) inspect(declarations.get(node.text));
      if (factories.has(node.text) && !visited.has(factories.get(node.text))) {
        const factory = factories.get(node.text); visited.add(factory); ts.forEachChild(factory, dependencies);
      }
    }
    ts.forEachChild(node, dependencies);
  }
  function inspect(declaration) {
    if (visited.has(declaration)) return;
    visited.add(declaration);
    const owner = declaration.name.getText(tree);
    function visit(node, field = '', id = '') {
      if (ts.isFunctionLike(node)) { dependencies(node); return; }
      if (ts.isIdentifier(node)) { dependencies(node); return; }
      if (ts.isObjectLiteralExpression(node)) {
        const identity = node.properties.find(p => ts.isPropertyAssignment(p) && ['id','slug'].includes(p.name.text))?.initializer?.text || id;
        for (const p of node.properties) visit(p, field, identity);
        return;
      }
      if (ts.isPropertyAssignment(node)) { visit(node.initializer, node.name.text || node.name.getText(tree), id); return; }
      // Expansion 4 uses [id, name, category, previewAspect, aspect, needs, action].
      if (templateFile && ts.isArrayLiteralExpression(node) && node.elements.length === 7 && node.elements.every(ts.isStringLiteral)) {
        node.elements.forEach((element, index) => visit(element, ['id','name','category','previewAspect','aspect','needs','prompt'][index], node.elements[0].text)); return;
      }
      if (literal(node) !== undefined) {
        if (visited.has(node)) return;
        visited.add(node);
        const text = literal(node);
        if (!(templateFile && ['needs','steps'].includes(field || owner)) && (text.trim().split(/\s+/).length < 4 || !(/^[A-Z]/.test(text) || /[.!?]$/.test(text)))) return;
        let status = 'unresolved', reason;
        let key;
        if (templateFile && field === 'needs') key = `presets.needs.${id}`;
        else if (templateFile && (field === 'steps' || owner === 'steps')) key = `presets.steps.${PRESET_STEP_KEYS[text]}`;
        if (key) {
          if (english[key] === text) { status = 'translated'; reason = `Display mapping: ${key}`; }
          else reason = `Missing or stale display mapping: ${key}`;
        } else {
          const diagnostic = helperDiagnostic(text);
          if (diagnostic?.code && english[`app.helpers.message.${diagnostic.code}`]) {
            status = 'translated'; reason = `helperCopy diagnostic: ${diagnostic.code}`;
          } else if (values.has(text)) {
            status = 'translated'; reason = 'English catalog match; render mapping covered by display regression tests.';
          } else {
            reason = dataException({ file, owner, field, text, templateFile });
            if (reason) status = 'allowlisted';
          }
        }
        rows.push({ node, field, owner, text, status, reason });
        return;
      }
      ts.forEachChild(node, child => visit(child, field, id));
    }
    if (declaration.initializer) visit(declaration.initializer);
  }
  for (const statement of tree.statements) {
    if (ts.isVariableStatement(statement) && statement.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of statement.declarationList.declarations) inspect(declaration);
    }
    if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier) dependencies(statement);
  }
  return rows;
}
