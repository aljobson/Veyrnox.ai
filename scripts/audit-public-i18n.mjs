// Static inventory of public UI copy, including conditional strings and props.
// This is a review aid, not a claim that arbitrary API/user data is translated.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import english from '../lib/i18n/messages/en.mjs';

const publicProps = new Set(['title', 'aria-label', 'placeholder', 'alt', 'label', 'ariaLabel', 'body', 'confirmLabel']);
const excluded = /^(?:app\/veyrnox\/(?:app|design-system)\/|app\/legal\/)/;
// Imports shared by MarketingNav/AppNav and public/private billing exports do
// not make the app-only render branches part of the public site.
const privateFiles = /\/(?:PaywallPrompt|TopUpPacks|editor\/EditorHelperLauncher)\.[jt]sx?$/;
const privateFunctions = {
  'app/veyrnox/_components/NavBar.js': new Set(['AppNav']),
  'app/veyrnox/_components/CreditSubscriptions.js': new Set(['message', 'CreditSubscriptions', 'Billing', 'SubscriptionCheckout', 'CurrentSubscription']),
};

// Exact public exceptions. Do not add blanket file exclusions for UI code.
const exceptions = [
  { pattern: /^(?:\.ai|cr)$/, reason: 'brand suffix or abbreviated Credits product name' },
  { file: /\/m\/create\/page\.js$/, pattern: /^−16 cr$/, reason: 'sample catalog price in Credits' },
  { file: /\/developers\/page\.js$/, pattern: /^(?:pipx install|veyrnox |OAuth 2\.1|token_endpoint_auth_method:|confirmed_credits$)/, reason: 'literal CLI/API code or protocol name' },
  { pattern: /^(?:VEYRNOX PUBLISH|VEYRNOX|Veyrnox\.ai(?: Publish)?|Veyrnox|Oddlings|Social Cinema|SOCIAL CINEMA|Cinema Pass|Clip Editor|Auto Short|Vey|Credits|MCP)$/, reason: 'brand or product name' },
  { file: /\/m\/(?:create|credits|explore|job|library)\/page\.js$/, pattern: /^(?:WAN 2\.5|Wan 2\.5|Kling 2\.6|Flux Kontext|MiniMax|Nano Banana|Seedream v4|Neon alley test|Sunset drift|Sunset skate reel|CCTV night hero|Product cut)/, reason: 'sample generation or model catalog data' },
  { file: /\/(?:presets\/\[id\]\/page|_components\/(?:TemplateRecipe|FilmPlayer)|_sections\/(?:film|showcase|hero))\.js$/, pattern: /^(?:SEEDANCE|WAN|KLING|FLUX|Veo|Seedance|Kling|Wan|Hailuo|Flux|MiniMax|FAL|fal)/, reason: 'model, film or template catalog data' },
  { file: /\/MascotAssistant\.jsx$/, pattern: /^Where are my saved Oddling passports\?$/, reason: 'provider text: canonical request for the existing English local help interpreter' },
  { file: /\/VeyConversation\.jsx$/, pattern: /^Guide me through using this saved Oddling passport\.$/, reason: 'provider text: canonical request for the existing English local help interpreter' },
  { file: /\/VeyTaskGuide\.jsx$/, pattern: /^What is the next step in my current task\?$/, reason: 'provider text: canonical request for the existing English local help interpreter' },
];

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (excluded.test(file)) return [];
    return entry.isDirectory() ? walk(file) : /\.[jm]?[jt]sx?$/.test(file) ? [file] : [];
  });
}
export function publicFiles() {
  const roots = ['app/veyrnox', 'app/social', 'app/auth/callback'].flatMap(walk)
    .filter(file => /\/(?:page|layout|error|loading|not-found)\.[jt]sx?$/.test(file));
  roots.push('app/layout.js', 'app/not-found.js', 'app/error.js', 'app/global-error.js');
  const files = new Set();
  function visit(file) {
    if (files.has(file) || excluded.test(file) || privateFiles.test(file) || !existsSync(file)) return;
    if (!/^(?:app\/(?:veyrnox|social|auth\/callback)\/|components\/|app\/(?:layout|not-found|error|global-error)\.js$)/.test(file)) return;
    files.add(file);
    const tree = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
    for (const node of tree.statements) {
      if (!(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) || !node.moduleSpecifier?.text.startsWith('.')) continue;
      const base = path.join(path.dirname(file), node.moduleSpecifier.text);
      const target = [base, `${base}.js`, `${base}.jsx`, `${base}.mjs`].find(f => existsSync(f) && statSync(f).isFile());
      if (target) visit(target);
    }
  }
  roots.forEach(visit);
  // Non-JSX modules hold excluded catalogs, source prompts, API contracts and
  // selectors. Their translated display sites are inspected in the UI modules.
  return [...files].filter(file => {
    const tree = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
    let jsx = false;
    function scan(node) { if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) jsx = true; else ts.forEachChild(node, scan); }
    scan(tree); return jsx;
  }).sort();
}
function owner(node) {
  for (let p = node; p; p = p.parent) {
    if (ts.isFunctionDeclaration(p)) return p.name?.text;
    if (ts.isVariableDeclaration(p)) return p.name.getText();
  }
}
function translateCall(node, tree) {
  return ts.isCallExpression(node) && /^(?:tOr|t|tr|translate|say|c)(?:\.label)?$/.test(node.expression.getText(tree));
}
// Version-bound legal declarations remain English by the 2026-10-18 host decision.
const legalStatements = new Set([
  "app/veyrnox/social-cinema/pass/PassPanel.js\nStart my Cinema Pass now. I understand it renews automatically until I cancel, and that if I cancel within 14 days I get back the unused share of what I paid.",
  "app/veyrnox/social-cinema/title/[id]/TitlePage.js\nUnlock now and add it to my account for good. I understand this spends credits straight away and that my right to cancel ends once I press play.",
  "app/veyrnox/social-cinema/creator/CreatorWorkspace.js\nI own or hold the rights to everything in this title, including any real people, voices, music and footage, and I have declared its AI use truthfully.",
  "app/veyrnox/social-cinema/creator/CreatorWorkspace.js\nThis title contains no nudity, pornography, explicit sexual content, sexualised minors, non-consensual intimate imagery, sexual violence, or sexual deepfake of a real person. I have read the",
  "app/veyrnox/social-cinema/creator/CreatorWorkspace.js\nCinema Content Policy",
  "app/veyrnox/social-cinema/creator/CreatorWorkspace.js\nI have not intentionally included malware, executable code, disguised files or links intended to compromise viewers or Veyrnox."
]);

function allowed(file, text) {
  if (legalStatements.has(`${file}\n${text}`)) return 'version-bound English legal statement; lawyer-reviewed translation required (ADR-0107)';
  return exceptions.find(rule => (!rule.file || rule.file.test(file)) && rule.pattern.test(text))?.reason;
}
export function candidates(file, source) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  const output = [];
  function add(node, kind, text, status, reason) {
    const value = text.replace(/\s+/g, ' ').trim();
    if (kind === 'expression' && (/^[/.#]/.test(value) || /^[?&][a-z_]+=/.test(value))) return;
    if (!/[A-Za-z]{2}/.test(value)) return;
    if (!status) { reason = allowed(file, value); status = reason ? 'allowlisted' : 'unresolved'; }
    output.push({ file, line: tree.getLineAndCharacterOfPosition(node.getStart()).line + 1, kind, text: value, status, ...(reason ? { reason } : {}) });
  }
  function visit(node) {
    if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && node.expression.getText(tree) === 'Error' && ['bad response', 'not saved', 'plans unavailable'].includes(node.arguments?.[0]?.text)) return;
    if (ts.isElementAccessExpression(node) && node.expression.getText(tree) === 't.messages') {
      add(node, 'lookup', node.argumentExpression.getText(tree), 'translated', 'catalog lookup'); return;
    }
    if (ts.isVariableDeclaration(node)) {
      const name = node.name.getText(tree);
      const mapped = (file.endsWith('/NavAuthButtons.js') && name === 'ACCOUNT_LINKS') || (file.endsWith('/m/_MobileNav.js') && ['TABS', 'jumps'].includes(name)) || (file.endsWith('/_sections/showcase.js') && ['LIST_GROUPS', 'GROUP_KEYS'].includes(name));
      if (mapped) { add(node, 'label-map', name, 'translated', 'display uses catalog keys or t.label'); return; }
      if (file.endsWith('/tools/loading.js') && name === 'PLACEHOLDERS') return; // React skeleton keys, never displayed
    }
    if (privateFunctions[file]?.has(owner(node))) return;
    if (translateCall(node, tree)) {
      const offset = node.expression.getText(tree) === 'tOr' ? 1 : 0;
      const first = node.arguments[offset];
      if (first && ts.isStringLiteral(first)) {
        const key = node.expression.getText(tree).endsWith('.label') ? `label.${first.text}` : first.text;
        const scoped = ['tr', 'c', 'say'].includes(node.expression.getText(tree));
        add(first, 'lookup', key, english[key] || scoped ? 'translated' : 'unresolved', english[key] || scoped ? undefined : 'missing English key');
      }
      // Slot values may themselves contain copy; inspect all but the key.
      node.arguments.slice(offset + 1).forEach(visit);
      return;
    }
    if (ts.isArrayLiteralExpression(node) && ts.isPropertyAccessExpression(node.parent) && node.parent.name.text === 'map') {
      // An array of enum ids used to select translated labels is not copy.
      if (/^(?:video|image|audio|spam|abuse|privacy|rights|other)$/.test(node.elements[0]?.text || '')) return;
    }
    if (ts.isJsxText(node)) { add(node, 'jsx', node.text); return; }
    if (ts.isJsxAttribute(node)) {
      if (!publicProps.has(node.name.text)) return;
      if (node.initializer && ts.isStringLiteral(node.initializer)) { add(node, 'prop', node.initializer.text); return; }
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      if (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent) || ts.isJsxAttribute(node.parent)) return;
      if (ts.isPropertyAssignment(node.parent) && node.parent.name === node) return;
      // Equality tests, object keys, route/URL construction and CSS never render.
      if (ts.isPropertyAssignment(node.parent) && ['dateStyle', 'timeStyle', 'day', 'month', 'year', 'timeZone', 'colorScheme'].includes(node.parent.name.getText(tree))) return;
      if (ts.isBinaryExpression(node.parent) && ![ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.PlusToken].includes(node.parent.operatorToken.kind)) return;
      let p = node.parent, jsx = false, ignored = false;
      while (p && !ts.isStatement(p)) {
        if (ts.isJsxExpression(p)) jsx = true;
        if ((ts.isCallExpression(p) || ts.isNewExpression(p)) && /^(?:providerAvailable|querySelector|matchMedia|console\.|.*\.(?:toLocaleDateString|toLocaleString|includes|startsWith|endsWith|querySelector|matchMedia|join|setAttribute))/.test(p.expression.getText(tree))) ignored = true;
        p = p.parent;
      }
      if (ts.isArrayLiteralExpression(node.parent) && ['creator', 'series'].includes(node.text)) return; // Following tab ids have separately translated labels
      const text = ts.isTemplateExpression(node) ? node.head.text + node.templateSpans.map(span => span.literal.text).join(' ') : node.text;
      if (!ignored && !/^(?:[/.#]|https?:|use client|use server)/.test(text) && !/(?:vx-|\b(?:px|py|mt|mb)-|=>|linear-gradient|\bBearer\b)/.test(text)
          && !/^(?:\(m(?:in|ax)-width:|(?:hidden|object-contain|text-sm|text-base|text-lg)(?:\s|$))/.test(text)
          && !/^(?:\s|[\d%+.,:;·/—−–()[\]{}-]|px|USD|ms|seconds)*$/.test(text)
          && (jsx || /\s/.test(text) || (ts.isPropertyAssignment(node.parent) && /^(?:label|title|description|message|placeholder)$/.test(node.parent.name.getText(tree))))) {
        add(node, 'expression', text);
      }
      if (!ts.isTemplateExpression(node)) return;
      node.templateSpans.forEach(span => visit(span.expression));
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2).filter(arg => arg !== '--all');
  const rows = (files.length ? files : publicFiles()).flatMap(file => candidates(file, readFileSync(file, 'utf8')));
  for (const row of rows) if (row.status !== 'translated' || process.argv.includes('--all')) console.log(JSON.stringify(row));
  const counts = Object.fromEntries(['translated', 'allowlisted', 'unresolved'].map(status => [status, rows.filter(row => row.status === status).length]));
  console.log(JSON.stringify({ summary: counts }));
  if (counts.unresolved) process.exitCode = 1;
}
