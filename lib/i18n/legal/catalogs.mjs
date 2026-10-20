import { isLocale } from '../locales.mjs';

export const LEGAL_DOCUMENTS = ['terms', 'privacy', 'refund', 'aup', 'cinema-content', 'gdpr'];

export async function legalDocument(locale, document) {
  if (!LEGAL_DOCUMENTS.includes(document)) throw new Error('Unknown legal document');
  const code = isLocale(locale) ? locale : 'en';
  const [messages, structure, chrome] = await Promise.all([
    import(`../messages/legal/${code}/${document}.mjs`),
    import(`./${document}.mjs`),
    import(`../messages/legal/${code}/chrome.mjs`),
  ]);
  return { messages: messages.default, blocks: structure.default, updated: structure.updated, chrome: chrome.default };
}
