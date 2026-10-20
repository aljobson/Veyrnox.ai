import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

// Keep the existing knowledge extractor reading the English source after legal
// documents move from JSX to catalogs. Both content and shape affect its hash.
export async function legalKnowledgeSource(root, document) {
  const catalogFile = path.join(root, 'lib/i18n/messages/legal/en', `${document}.mjs`);
  const shapeFile = path.join(root, 'lib/i18n/legal', `${document}.mjs`);
  const catalogSource = await readFile(catalogFile, 'utf8');
  const shapeSource = await readFile(shapeFile, 'utf8');
  const messages = (await import(pathToFileURL(catalogFile).href)).default;
  const blocks = (await import(pathToFileURL(shapeFile).href)).default;
  const chromeSource = await readFile(path.join(root, 'lib/i18n/messages/legal/en/chrome.mjs'), 'utf8');
  const chrome = (await import(pathToFileURL(path.join(root, 'lib/i18n/messages/legal/en/chrome.mjs')).href)).default;
  function render(block) {
    const attrs = Object.entries(block.attrs || {}).map(([key, value]) => ` ${key}="${escape(value)}"`).join('');
    const text = block.children ? block.children.map(render).join('') : escape(messages[block.key]).replace(/\{(inline\d+)\}/g, (_, key) => render(block.slots[key]));
    return `<${block.tag}${attrs}>${text}</${block.tag}>`;
  }
  return { file: catalogFile, source: `<LegalPage title="${escape(messages.title)}">${blocks.map(render).join('\n')}</LegalPage><a aria-label="${escape(chrome.home)}" /><nav aria-label="${escape(chrome.nav)}" />\n/* ${catalogSource}\n${shapeSource}\n${chromeSource} */` };
}
