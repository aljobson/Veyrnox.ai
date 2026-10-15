import { readOddlingLibrary } from '../app/veyrnox/_lib/oddlingStudio.js';
import { CHARACTER_GROUPS } from '../app/veyrnox/_lib/character.js';
import { characterOptionLabel } from '../app/veyrnox/_lib/characterOptions.js';

export const REVEAL_SAVED_ODDLING = 'veyrnox:reveal-saved-oddling';
const normal = (value) => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Runs only in the browser. Neither passports nor local conversation turns
// are sent to the help API, analytics or the model provider.
export function savedOddlingHelp(question, storage, { selectedId, previousId, loadedId, pathname = '/app' } = {}) {
  const items = readOddlingLibrary(storage);
  const q = normal(question);
  const matches = items.filter(({ name }) => normal(name).length > 1 && ` ${q} `.includes(` ${normal(name)} `));
  const explicitSaved = /\b(saved|my|history|passport)\b/.test(q) && /\b(odd|oddlings?|characters?|passports?|history)\b/.test(q);
  const followup = previousId && !/\b(web|search|chat|account|security|password|publish|film)\b/.test(q)
    && /\b(next|it|them|their|her|his|voice|canon|outfit|traits|show|prompt|use|load|edit|animate)\b/.test(q);
  if (!selectedId && !matches.length && !explicitSaved && !followup) return null;
  const chosen = items.find(({ id }) => id === selectedId)
    || (matches.length === 1 ? matches[0] : null)
    || (!matches.length && !explicitSaved && followup ? items.find(({ id }) => id === previousId) : null);
  const choices = (matches.length > 1 ? matches : items).map(({ id, name, savedAt }) => ({ id, name, savedAt }));
  const base = { source: 'local', localOnly: true, action: 'activate_target', target: 'oddlings.history', savedChoices: choices };
  if (!items.length) return { ...base, message: 'There are no saved Oddling passports in this browser. Build a character in Oddling Studio, then choose Save passport. Saved passports are browser-local, so characters saved on another device will not appear here.' };
  if (!chosen) return { ...base, message: matches.length > 1
    ? 'More than one saved passport matches. Choose the version below; I will not guess or replace your current draft.'
    : `I found ${items.length} saved Oddling passport${items.length === 1 ? '' : 's'} in this browser. Choose one below and I can describe its saved traits and guide you through using it. Nothing is uploaded to an AI provider.` };

  const p = chosen.picks;
  const fields = /\b(voice|sound|tone)\b/.test(q) ? [['Voice', p.oddling_voice]]
    : /\b(show|obsession|premise|follow)\b/.test(q) ? [['Creator premise', p.oddling_obsession], ['Recurring show', p.oddling_show]]
    : /\b(canon|look|outfit|trait|body|hair|hand|foot|feet|describe|who)\b/.test(q)
      ? [['Visual canon', p.oddling_rule], ...CHARACTER_GROUPS.filter(({ id }) => p[id]).map(({ id, label }) => [label, characterOptionLabel(id, p[id])])]
      : [['Creator premise', p.oddling_obsession], ['Voice', p.oddling_voice], ['Recurring show', p.oddling_show], ['Visual canon', p.oddling_rule]];
  const details = fields.filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`).join('. ').slice(0, 850);
  const loaded = loadedId === chosen.id;
  const inCreate = pathname === '/app/create';
  const handedOff = inCreate && previousId === chosen.id && !selectedId;
  const instructions = handedOff
    ? 'If you continued to Create with this passport, review the draft prompt, image model and Total cost. Your saved passport stays unchanged. Only you press Generate; the result appears in Library.'
    : inCreate
    ? 'To reuse this saved version, open its History card first. After loading it, choose Continue to portrait generation, then review the model, prompt and Total cost in Create. Only you press Generate.'
    : loaded
      ? 'Your character is loaded in the builder. 1. Review or edit its traits. 2. Open Generation prompt preview. 3. Choose Continue to portrait generation. 4. In Create, review the model, prompt and Total cost, then personally press Generate.'
      : '1. Open this saved passport in History. 2. Personally choose Load and edit (this replaces the current builder draft, not the saved passport). 3. Review the prompt preview. 4. Continue to portrait generation, then review the price in Create.';
  const animation = /\b(animate|animation|motion|video)\b/.test(q)
    ? ' Saved custom passports do not have a built-in animation portrait. Create a portrait first, then reuse that image with an image-to-video model in Create; do not substitute a built-in cast portrait.' : '';
  return {
    ...base, savedChoices: [], selectedSavedId: chosen.id,
    savedOddlingId: loaded || handedOff ? null : chosen.id,
    action: 'show_target', target: handedOff ? 'create.cost' : loaded ? (/\b(next|continue|create)\b/.test(q) ? 'oddlings.continue' : 'oddlings.prompt') : 'oddlings.history',
    message: `${chosen.name} — saved passport. ${details || 'No identity details saved yet.'} ${instructions}${animation}`,
  };
}

export function publicHelpHistory(messages) {
  return messages.filter((message) => !message.pending && !message.localOnly).slice(-6)
    .map(({ role, content }) => ({ role, content }));
}
