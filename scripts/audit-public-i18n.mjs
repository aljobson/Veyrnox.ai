// Static inventory of public UI copy, including conditional strings and props.
// This is a review aid, not a claim that arbitrary API/user data is translated.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { helperExceptions } from './lib/helper-i18n-exceptions.mjs';
import publicEnglish from '../lib/i18n/messages/en.mjs';
import appEnglish from '../lib/i18n/messages/app/en.mjs';
const english = { ...publicEnglish, ...appEnglish };

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
  ...helperExceptions,
  { file: /\/_lib\/(?:showcase|sourceTemplateExpansion\d*|character|characterOptions|oddlingCatalog)\.js$/, pattern: /./, reason: 'source catalog names, descriptors and prompts remain unchanged (ADR-0107)' },
  { file: /\/_lib\/(?:studioSkills|filmStudioAssistants)\.js$/, pattern: /^(?:Skill:|Film stage)/, reason: 'canonical assistant instructions, not UI copy (ADR-0107)' },
  { file: /\/_lib\/filmStudio\.js$/, pattern: /^Neutral grey background/, reason: 'generated reference-sheet prompt, not UI copy (ADR-0107)' },
  { file: /\/_lib\/oddlingStudio\.js$/, pattern: /^Animate /, reason: 'generated motion prompt, not UI copy (ADR-0107)' },
  { file: /\/_lib\/(?:editorVisionRuntime|localSpeechAssets)\.mjs$/, pattern: /^default-src /, reason: 'CSP protocol value, not visible text' },
  { file: /^lib\/social\/networks\.js$/, pattern: /./, reason: 'social network brand names remain unchanged (ADR-0107)' },
  { file: /\/_components\/editor\/(?:OriginalAudioPanel|PersonProcessingControls|MotionProcessingControls)\.js$/, pattern: /^(?:Processed video|Original audio\/|Veyrnox procedural synthesizer|Generated locally; version 1 preset\.)$/, reason: 'canonical persisted folder/attribution metadata; display translation is separate' },
  { file: /\/publish\/ads\/page\.js$/, pattern: /^United Kingdom$/, reason: 'canonical stored campaign targeting value, not a translated display label' },

  { file: /\/editor\/AgentPanel\.js$/, pattern: /^(?:split the first clip at 2 seconds|remove the last clip|set the volume of the first clip to 40%|add the title "Day one")$/, reason: 'literal command prompts accepted by the existing English-only local parser; no localized parser exists' },
  { file: /\/editor\/MultitrackWorkspace\.js$/, pattern: /^(?:Veyrnox\.ai Cut|Cut)$/, reason: 'Cut is the editor product name in the branded header' },
  { file: /\/publish\/smartlink\/page\.js$/, pattern: /^(?:veyrnox\.ai\/s\/|https:\/\/)$/, reason: 'literal branded address or URL protocol required by the link editor' },
  { file: /\/publish\/BlueskyConnect\.js$/, pattern: /^you\.bsky\.social$/, reason: 'brand-domain example showing the required Bluesky handle format' },
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

function walk(directory, exclude = excluded) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (exclude.test(file)) return [];
    return entry.isDirectory() ? walk(file, exclude) : /\.[jm]?[jt]sx?$/.test(file) ? [file] : [];
  });
}
export function publicFiles({ app = false } = {}) {
  const exclude = app ? /^app\/veyrnox\/app\/admin(?:\/|$)/ : excluded;
  const roots = (app ? ['app/veyrnox/app'] : ['app/veyrnox', 'app/social', 'app/auth/callback']).flatMap(directory => walk(directory, exclude))
    .filter(file => /\/(?:page|layout|template|error|loading|not-found)\.[jt]sx?$/.test(file));
  roots.push('app/layout.js', 'app/not-found.js', 'app/error.js', 'app/global-error.js');
  const files = new Set();
  function visit(file) {
    if (files.has(file) || exclude.test(file) || (!app && privateFiles.test(file)) || !existsSync(file)) return;
    if (/^lib\/i18n\//.test(file)) return;
    if (!/^(?:app\/(?:veyrnox|social|auth\/callback)\/|components\/|app\/(?:layout|not-found|error|global-error)\.js$|lib\/)/.test(file)) return;
    files.add(file);
    const tree = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
    for (const node of tree.statements) {
      if (!(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) || !node.moduleSpecifier) continue;
      const specifier = node.moduleSpecifier.text;
      if (!specifier.startsWith('.') && !specifier.startsWith('@/')) continue;
      const base = specifier.startsWith('@/') ? specifier.slice(2) : path.join(path.dirname(file), specifier);
      const target = [base, `${base}.js`, `${base}.jsx`, `${base}.mjs`].find(f => existsSync(f) && statSync(f).isFile());
      if (target) visit(target);
    }
  }
  roots.forEach(visit);
  // Inventory imported helper copy as well as JSX display sites.
  return [...files].filter(file => {
    const tree = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
    let jsx = false;
    function scan(node) { if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) jsx = true; else ts.forEachChild(node, scan); }
    scan(tree); return jsx || (app && /(?:^lib\/|\/_lib\/)/.test(file));
  }).sort();
}
export const appFiles = () => publicFiles({ app: true });
function owner(node) {
  for (let p = node; p; p = p.parent) {
    if (ts.isFunctionDeclaration(p)) return p.name?.text;
    if (ts.isVariableDeclaration(p)) return p.name.getText();
  }
}
function translateCall(node, tree) {
  return ts.isCallExpression(node) && /^(?:(?:tOr|t|tr|translate|say|c)(?:\.label)?|translation\.current)$/.test(node.expression.getText(tree));
}
// Version-bound legal declarations remain English by the 2026-10-18 host decision.
const legalStatements = new Set([
  "app/veyrnox/_components/TopUpPacks.js\nI want my credits added to my account straight away. I understand that once I use any of these credits to generate, I lose my right to cancel this purchase.",
  "app/veyrnox/_components/chat/MediaComposer.js\nI own these files or have permission to use every identifiable person, voice, brand, artwork, and recording under the",
  "app/veyrnox/_components/chat/MediaComposer.js\nAcceptable Use Policy",

  "app/veyrnox/_components/CreditSubscriptions.js\nI agree to",
  "app/veyrnox/_components/CreditSubscriptions.js\nat",
  "app/veyrnox/_components/CreditSubscriptions.js\nplus applicable tax every",
  "app/veyrnox/_components/CreditSubscriptions.js\nuntil I cancel. I receive",
  "app/veyrnox/_components/CreditSubscriptions.js\nCredits after each confirmed",
  "app/veyrnox/_components/CreditSubscriptions.js\nly payment; unused cycle Credits expire without rollover.",

  "app/veyrnox/_components/editor/GenerationPanel.js\nI own this file, or I have the permission of everyone identifiable in it. No real person’s face, body or voice is used without their consent, and I hold the rights to any brand, artwork or recording in it (",
  "app/veyrnox/_components/editor/GenerationPanel.js\nAcceptable Use",
  "app/veyrnox/_components/editor/GenerationPanel.js\n). This statement is recorded against the generation and your account.",

  "app/veyrnox/app/publish/plan/PublishPlanPanel.js\nStart my Publish Plan at",
  "app/veyrnox/app/publish/plan/PublishPlanPanel.js\nplus tax every",
  "app/veyrnox/app/publish/plan/PublishPlanPanel.js\n. I understand it renews automatically until I cancel.",
  "app/veyrnox/_components/SourceRightsConfirmation.jsx\nI own this file, or I have the permission of everyone identifiable in it. No real person&apos;s face, body or voice is used without their consent, and I hold the rights to any brand, artwork or recording in it (",
  "app/veyrnox/_components/SourceRightsConfirmation.jsx\nAcceptable Use",
  "app/veyrnox/_components/SourceRightsConfirmation.jsx\n). This statement is recorded against the generation and your account.",
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
export function candidates(file, source, { app = false } = {}) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  const output = [];
  const helper = /(?:^lib\/|\/_lib\/)/.test(file);
  const catalogValues = new Set(Object.values(english).map(text => text.replace(/\{\w+\}/g, ' ').replace(/\s+/g, ' ').trim()));
  function add(node, kind, text, status, reason) {
    const value = text.replace(/\s+/g, ' ').trim();
    if (kind === 'expression' && (/^[/.#]/.test(value) || /^[?&][a-z_]+=/.test(value))) return;
    if (!/[A-Za-z]{2}/.test(value)) return;
    if (!status && helper && catalogValues.has(value)) { status = 'translated'; reason = 'helper copy has an English catalog entry; display mapping requires review'; }
    if (!status) { reason = allowed(file, value); status = reason ? 'allowlisted' : 'unresolved'; }
    output.push({ file, line: tree.getLineAndCharacterOfPosition(node.getStart()).line + 1, kind, text: value, status, ...(reason ? { reason } : {}) });
  }
  function visit(node) {
    if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && node.expression.getText(tree) === 'Error' && ['bad response', 'not saved', 'plans unavailable'].includes(node.arguments?.[0]?.text)) return;
    if (ts.isElementAccessExpression(node) && node.expression.getText(tree) === 't.messages') {
      add(node, 'lookup', node.argumentExpression.getText(tree), 'translated', 'catalog lookup'); return;
    }
    if (ts.isVariableDeclaration(node)) {
      // SVG geometry is not display copy. Verify every entry is path syntax.
      if (['paths', 'controlPaths'].includes(node.name.getText(tree)) && ts.isObjectLiteralExpression(node.initializer) && new RegExp(`<path d=\\{${node.name.getText(tree)}\\[(?:network|name)\\]\\}`).test(source) && node.initializer.properties.every(property => ts.isPropertyAssignment(property) && ts.isStringLiteral(property.initializer) && /^[Mm][MmZzLlHhVvCcSsQqTtAaEe\d., +\-]+$/.test(property.initializer.text))) return;
      // A validated gradient palette consumed as className is CSS, not display copy.
      if (node.name.getText(tree) === 'backgrounds' && ts.isObjectLiteralExpression(node.initializer) && /className=\{`[^`]*\$\{backgrounds\[/.test(source) && node.initializer.properties.every(property => ts.isPropertyAssignment(property) && ts.isStringLiteral(property.initializer) && /^(?:from|via|to)-[a-z]+-\d{2,3}(?: (?:from|via|to)-[a-z]+-\d{2,3})*$/.test(property.initializer.text))) return;
      const name = node.name.getText(tree);
      const mapped = (file.endsWith('/NavAuthButtons.js') && name === 'ACCOUNT_LINKS') || (file.endsWith('/m/_MobileNav.js') && ['TABS', 'jumps'].includes(name)) || (file.endsWith('/_sections/showcase.js') && ['LIST_GROUPS', 'GROUP_KEYS'].includes(name));
      if (mapped) { add(node, 'label-map', name, 'translated', 'display uses catalog keys or t.label'); return; }
      if (file.endsWith('/tools/loading.js') && name === 'PLACEHOLDERS') return; // React skeleton keys, never displayed
    }
    if (!app && privateFunctions[file]?.has(owner(node))) return;
    if (translateCall(node, tree)) {
      const offset = node.expression.getText(tree) === 'tOr' ? 1 : 0;
      const first = node.arguments[offset];
      if (first && ts.isStringLiteral(first)) {
        const key = node.expression.getText(tree).endsWith('.label') ? `label.${first.text}` : first.text;
        const scoped = ['tr', 'c', 'say'].includes(node.expression.getText(tree));
        add(first, 'lookup', key, english[key] || scoped ? 'translated' : 'unresolved', english[key] || scoped ? undefined : 'missing English key');
      }
      if (first && ts.isTemplateExpression(first)) {
        const prefix = first.head.text;
        if (prefix.includes('.') && !Object.keys(english).some(key => key.startsWith(prefix))) {
          const fallback = node.expression.getText(tree) === 'tOr' && node.arguments[2];
          const translatedFallback = fallback && ts.isCallExpression(fallback) && translateCall(fallback, tree) && english[fallback.arguments[0]?.text];
          add(first, 'lookup', first.getText(tree), translatedFallback ? 'translated' : 'unresolved', translatedFallback ? 'translated generic fallback; no code-specific catalog entries' : 'dynamic lookup family has no catalog keys');
        }
      }
      if (node.expression.getText(tree) === 'tOr') {
        const fallback = node.arguments[2];
        if (fallback && ts.isStringLiteral(fallback) && /\s/.test(fallback.text) && !catalogValues.has(fallback.text)) add(fallback, 'fallback', fallback.text, 'unresolved', 'fallback has no English catalog entry');
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
      if (!publicProps.has(node.name.text) && !(app && /^on[A-Z]/.test(node.name.text))) return;
      if (node.initializer && ts.isStringLiteral(node.initializer)) { add(node, 'prop', node.initializer.text); return; }
    }
    if (helper && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node))) {
      const returned = ts.isReturnStatement(node.parent);
      const field = ts.isPropertyAssignment(node.parent) && /^(?:label|title|body|description|message|placeholder|action)$/.test(node.parent.name.getText(tree));
      if (!returned && !field) return;
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      if (ts.isCallExpression(node.parent) && node.parent.expression.getText(tree) === 'box' && node.parent.arguments[2] === node) return;
      if (ts.isArrayLiteralExpression(node.parent) && node.parent.elements[0] === node && ['source', 'target'].includes(node.text) && node.parent.elements.length === 4) return;
      if (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent) || ts.isJsxAttribute(node.parent)) return;
      if (ts.isPropertyAssignment(node.parent) && node.parent.name === node) return;
      // Equality tests, object keys, route/URL construction and CSS never render.
      if (ts.isPropertyAssignment(node.parent) && ['dateStyle', 'timeStyle', 'day', 'month', 'year', 'timeZone', 'colorScheme'].includes(node.parent.name.getText(tree))) return;
      if (ts.isBinaryExpression(node.parent) && ![ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.PlusToken].includes(node.parent.operatorToken.kind)) return;
      let p = node.parent, jsx = false, ignored = false, event = false, visibleCall = false;
      while (p && !ts.isStatement(p)) {
        if (ts.isJsxExpression(p)) jsx = true;
        if (ts.isJsxAttribute(p) && /^on[A-Z]/.test(p.name.text)) event = true;
        if (app && ts.isCallExpression(p) && /^(?:toast(?:\.(?:success|error|info|warning))?|(?:window\.)?(?:alert|confirm|prompt)|set(?:Error|Message|Status))$/.test(p.expression.getText(tree))) visibleCall = true;
        if ((ts.isCallExpression(p) || ts.isNewExpression(p)) && /^(?:providerAvailable|querySelector|matchMedia|console\.|.*\.(?:toLocaleDateString|toLocaleString|includes|startsWith|endsWith|querySelector|closest|matchMedia|join|setAttribute))/.test(p.expression.getText(tree))) ignored = true;
        p = p.parent;
      }
      if (ts.isArrayLiteralExpression(node.parent) && ['creator', 'series'].includes(node.text)) return; // Following tab ids have separately translated labels
      const text = ts.isTemplateExpression(node) ? node.head.text + node.templateSpans.map(span => span.literal.text).join(' ') : node.text;
      if (!ignored && !/^(?:[/.#]|https?:|use client|use server)/.test(text) && !/(?:vx-|\b(?:px|py|mt|mb)-|=>|linear-gradient|\bBearer\b)/.test(text)
          && !/^(?:\(m(?:in|ax)-width:|(?:hidden|object-contain|text-sm|text-base|text-lg)(?:\s|$))/.test(text)
          && !/^(?:\s|[\d%+.,:;·/—−–()[\]{}-]|px|USD|ms|seconds)*$/.test(text)
          && ((jsx && !event) || visibleCall || /\s/.test(text) || (ts.isPropertyAssignment(node.parent) && /^(?:label|title|description|message|placeholder)$/.test(node.parent.name.getText(tree))))) {
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
  const app = process.argv.includes('--app');
  const files = process.argv.slice(2).filter(arg => !['--all', '--app'].includes(arg));
  const rows = (files.length ? files : app ? appFiles() : publicFiles()).flatMap(file => candidates(file, readFileSync(file, 'utf8'), { app }));
  for (const row of rows) if (row.status !== 'translated' || process.argv.includes('--all')) console.log(JSON.stringify(row));
  const counts = Object.fromEntries(['translated', 'allowlisted', 'unresolved'].map(status => [status, rows.filter(row => row.status === status).length]));
  console.log(JSON.stringify({ summary: counts }));
  if (counts.unresolved) process.exitCode = 1;
}
