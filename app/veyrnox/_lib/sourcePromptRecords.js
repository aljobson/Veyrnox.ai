import { GENJUTSU_SOURCE_PROMPT_RECORDS } from './genjutsuSourcePromptRecords.js';
import { HIGGSFIELD_90_SOURCE_PROMPT_RECORDS } from './higgsfieldCommunityExpansion90Records.js';
import { SYNTX_SOURCE_PROMPT_RECORDS } from './syntxSourcePromptRecords.js';

export const SOURCE_PROMPT_RECORDS = Object.freeze({
  ...GENJUTSU_SOURCE_PROMPT_RECORDS,
  ...HIGGSFIELD_90_SOURCE_PROMPT_RECORDS,
  ...SYNTX_SOURCE_PROMPT_RECORDS,
});

export function exactSourcePromptRecord(templateId) {
  const source = SOURCE_PROMPT_RECORDS[templateId];
  return source?.sourcePromptAvailable && typeof source.prompt === 'string' ? source : null;
}
