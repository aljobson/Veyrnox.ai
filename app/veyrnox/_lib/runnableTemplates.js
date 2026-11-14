import { imageTemplateModelAvailable } from './imageTemplateModels.js';
import { templateModelId } from './tokens.js';

const TEMPLATE_KINDS = new Set(['image', 'video', 'audio']);

export function effectiveTemplateKind(goal, selectedKind) {
  if (TEMPLATE_KINDS.has(goal)) return goal;
  return TEMPLATE_KINDS.has(selectedKind) ? selectedKind : null;
}

/**
 * Templates that can run in this studio: the template's own model must be in
 * the list the studio offers, and only those of the current goal's kind are kept
 * (image, video or audio); the 'all' goal keeps every kind.
 * @returns {{preset:object, model:object}[]}
 */
export function runnableTemplates(templates, models, goal) {
  const byId = new Map((models || []).map((model) => [model.id, model]));
  const rows = (templates || []).map((preset) => ({ preset, model: byId.get(templateModelId(preset)) }))
    .filter((row) => row.model && imageTemplateModelAvailable(row.preset, row.model) && (row.preset.promptPreview ?? row.preset.prompt)?.trim());
  const kind = effectiveTemplateKind(goal);
  return kind ? rows.filter((row) => row.model.kind === kind) : rows;
}
