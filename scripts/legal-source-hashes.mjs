import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import { LEGAL_DOCUMENTS, legalDocument } from '../lib/i18n/legal/catalogs.mjs';
import { BINDINGS, LEGAL_CHROME } from '../lib/i18n/legal/binding.mjs';
import { bindingInventory } from './lib/legal-i18n.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifestPath = path.join(root, 'lib/i18n/messages/legal/source-hashes.json');
export const STALE_MESSAGE = 'English changed: re-translate or confirm the translations, then run node scripts/legal-source-hashes.mjs --update';
export const hashText = value => createHash('sha256').update(value).digest('hex');

export async function currentSources() {
  const documents = {};
  for (const document of LEGAL_DOCUMENTS) {
    const { messages, updated } = await legalDocument('en', document);
    documents[document] = {
      translationsReviewedAgainstEnglishDated: updated,
      hashes: Object.fromEntries(Object.entries(messages).map(([key, value]) => [key, hashText(value)])),
    };
  }
  const hashes = messages => Object.fromEntries(Object.entries(messages).map(([key, value]) => [key, hashText(value)]));
  const anchors = {};
  const dir = path.join(root, 'app/veyrnox');
  for (const file of readdirSync(dir, { recursive: true }).filter(file => /\.(js|jsx)$/.test(file))) {
    const source = readFileSync(path.join(dir, file), 'utf8');
    if (!source.includes('<BindingText')) continue;
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
    for (const entry of bindingInventory(tree, { checkAnchors: false }).paired.values()) {
      if (!entry.valid) throw new Error(`Invalid English binding: ${file}/${entry.id}`);
      if (anchors[entry.id] && JSON.stringify(anchors[entry.id]) !== JSON.stringify(entry.anchors)) {
        throw new Error(`Inconsistent English anchors: ${entry.id}`);
      }
      anchors[entry.id] = entry.anchors;
    }
  }
  return { documents, binding: hashes(BINDINGS.en), chrome: hashes(LEGAL_CHROME.en), anchors };
}

export function staleEntries(expected, current, prefix = '') {
  const changes = [];
  for (const key of new Set([...Object.keys(expected || {}), ...Object.keys(current || {})])) {
    const before = expected?.[key], after = current?.[key], name = prefix ? `${prefix}.${key}` : key;
    if (before && after && typeof before === 'object' && typeof after === 'object') {
      changes.push(...staleEntries(before, after, name));
    } else if (before !== after) changes.push(name);
  }
  return changes;
}

export function assertCurrentSources(expected, current) {
  const changes = staleEntries(expected, current);
  if (changes.length) throw new Error(`${STALE_MESSAGE}\n${changes.join('\n')}`);
}

export async function checkSources() {
  assertCurrentSources(JSON.parse(readFileSync(manifestPath, 'utf8')), await currentSources());
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes('--update')) {
      writeFileSync(manifestPath, `${JSON.stringify(await currentSources(), null, 2)}\n`);
      console.log('Legal English source hashes and anchor confirmations updated.');
    } else {
      await checkSources();
      console.log('Legal English source hashes and anchors are current.');
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
