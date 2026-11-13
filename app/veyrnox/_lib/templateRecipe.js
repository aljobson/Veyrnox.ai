import { exactSourcePromptRecord } from './sourcePromptRecords.js';
import { sourcePromptAuditForModel } from './sourcePromptAudit.js';
import { templateModelId } from './tokens.js';
import { fallbackCapabilitiesFor } from '../../../lib/fallbackModelCapabilities.js';

// An authored recipe has no community-source audit to pass or fail.
export function templateRecipe(template) {
  if (template.promptOrigin !== 'community-source-exact') return { ...template };
  const sourcePrompt = exactSourcePromptRecord(template.id)?.prompt ?? null;
  const audit = sourcePromptAuditForModel(template.id, fallbackCapabilitiesFor(templateModelId(template))?.inputs?.prompt?.max);
  return {
    ...template,
    sourcePrompt,
    sourcePromptOrigin: sourcePrompt ? 'community-source-exact' : null,
    sourcePromptStatus: audit.status,
    sourcePromptRunnable: audit.runnable,
    sourcePromptIssues: [...audit.issues],
    sourcePromptModelPromptMax: audit.modelPromptMax ?? null,
    sourcePromptDuplicateOf: audit.duplicateOf,
  };
}
