import { modelIdForName } from './tokens.js';

/**
 * Templates that can run in this studio: the template's own model must be in
 * the list the studio offers, and those of the current goal's kind come first.
 * @returns {{preset:object, model:object}[]}
 */
export function runnableTemplates(templates, models, goal) {
  const byId = new Map((models || []).map((model) => [model.id, model]));
  const rows = (templates || []).map((preset) => ({ preset, model: byId.get(modelIdForName(preset.model)) }))
    .filter((row) => row.model && typeof row.preset.prompt === 'string' && row.preset.prompt.trim());
  if (goal !== 'image' && goal !== 'video') return rows;
  return [...rows.filter((row) => row.model.kind === goal), ...rows.filter((row) => row.model.kind !== goal)];
}
