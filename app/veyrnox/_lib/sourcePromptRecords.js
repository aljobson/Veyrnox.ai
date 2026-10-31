import { GENJUTSU_SOURCE_PROMPT_RECORDS } from './genjutsuSourcePromptRecords.js';
import { HIGGSFIELD_90_SOURCE_PROMPT_RECORDS } from './higgsfieldCommunityExpansion90Records.js';
import { SYNTX_SOURCE_PROMPT_RECORDS } from './syntxSourcePromptRecords.js';
import { SEEDANCE_SOURCE_PROMPT_RECORDS } from './seedanceSourcePromptRecords.js';
import { recordLookup } from './templateIds.js';

export const SOURCE_PROMPT_RECORDS = Object.freeze({
  ...GENJUTSU_SOURCE_PROMPT_RECORDS,
  ...HIGGSFIELD_90_SOURCE_PROMPT_RECORDS,
  ...SYNTX_SOURCE_PROMPT_RECORDS,
  ...SEEDANCE_SOURCE_PROMPT_RECORDS,
});

const recordFor = recordLookup(SOURCE_PROMPT_RECORDS);

// The published copy of a prompt drops a source-platform name the prompt
// itself carries (one record opens "HIGGSFIELD VIDEO RECREATION PROMPT");
// the record above keeps the text exactly as received.
const PLATFORM_WORD = /\b(?:higgsfield|syntx)\s+/gi;
const PUBLISHED = new Map();

export function exactSourcePromptRecord(templateId) {
  const source = recordFor(templateId);
  if (!source?.sourcePromptAvailable || typeof source.prompt !== 'string') return null;
  if (!PLATFORM_WORD.test(source.prompt)) return source;
  PLATFORM_WORD.lastIndex = 0;
  if (!PUBLISHED.has(source)) PUBLISHED.set(source, Object.freeze({ ...source, prompt: source.prompt.replace(PLATFORM_WORD, '') }));
  return PUBLISHED.get(source);
}
