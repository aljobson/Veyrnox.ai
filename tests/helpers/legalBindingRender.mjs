import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as React from 'react';
import { fixture } from './publicSiteRender.mjs';

export const bindingFiles = Object.keys(JSON.parse(readFileSync('tests/fixtures/legal-binding-contracts-main.json', 'utf8')));
export function bindingLabels(file, source = readFileSync(file, 'utf8')) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  const result = [];
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === 'BindingText') {
      const id = node.openingElement.attributes.properties.find(attr => attr.name?.text === 'id')?.initializer?.text;
      result.push({ id, jsx: node.getText(tree) });
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return result;
}

// Render the real call-site JSX in a small scope with fixed checkout values.
// This avoids network/auth setup while preserving its inputs, label and handlers.
export function renderBinding(file, jsx, locale, source = readFileSync(file, 'utf8')) {
  const imports = source.split('\n').filter(line => /^import .*BindingText/.test(line)).join('\n');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  const constants = {};
  for (const statement of tree.statements) if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      if (/TEXT$/.test(declaration.name.getText(tree)) && declaration.initializer && ts.isStringLiteral(declaration.initializer)) constants[declaration.name.getText(tree)] = declaration.initializer.text;
    }
  }
  const snippet = `${imports}
import englishBindings from '${'../'.repeat(file.split('/').length - 1)}lib/i18n/messages/legal/en/binding.mjs';
const ${'SUPPLY_CONSENT_TEXT'} = englishBindings.supply;
const CONSENT_TEXT = ${JSON.stringify(constants.CONSENT_TEXT || '')};
const RIGHTS_TEXT = ${JSON.stringify(constants.RIGHTS_TEXT || '')};
export default function Probe() {
  const agreed = false, consent = false, confirmed = false;
  const setAgreed = () => {}, setConsent = () => {}, onChange = () => {};
  const names = { test: 'Test plan' }, plan = { id: 'test', price_usd_cents: 1000, billing_interval: 'month', credits: 1200 }, selectedPlan = plan;
  const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }), legalMoney = usd;
  const intervalName = () => 'month';
  const t = () => 'Refund policy';
  return (${jsx});
}`;
  const f = fixture(locale, '/app/credits', { sourceOverrides: { [file]: snippet } });
  return f.render(React.createElement(f.load(file).default));
}
