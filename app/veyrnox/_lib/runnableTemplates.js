import { templateModelId } from './tokens.js';

/**
 * Templates that can run in this studio: the template's own model must be in
 * the list the studio offers, and only those of the current goal's kind are kept
 * (image, video or audio); the 'all' goal keeps every kind.
 * @returns {{preset:object, model:object}[]}
 */
export function runnableTemplates(templates, models, goal) {
  const byId = new Map((models || []).map((model) => [model.id, model]));
  const rows = (templates || []).map((preset) => ({ preset, model: byId.get(templateModelId(preset)) }))
    .filter((row) => row.model && (row.preset.promptPreview ?? row.preset.prompt)?.trim());
  if (goal !== 'image' && goal !== 'video' && goal !== 'audio') return rows;
  return rows.filter((row) => row.model.kind === goal);
}
