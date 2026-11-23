import { MODELS, presetTitle, templateModelId } from './tokens.js';

// Display only. A video template's words stay in state and are sent exactly as before, and they still reach the browser
// in the template data: this keeps them off the screen by default. It does not protect the prompt.
export function isVideoTemplate(template) {
  if (!template || template.kind === 'image' || template.kind === 'audio') return false;
  const kind = MODELS.find(model => model.id === (template.modelId || templateModelId(template)))?.kind;
  return kind ? kind === 'video' : true;
}

export function isUneditedTemplatePrompt(template, prompt) {
  return isVideoTemplate(template) && typeof prompt === 'string' && prompt.length > 0
    && (prompt === template.prompt || prompt === template.sourcePrompt);
}

export function templatePromptHidden(template, prompt, revealedId) {
  return isUneditedTemplatePrompt(template, prompt) && revealedId !== template.id;
}

/** What Library and the job tray call a run: the template's name for its own words, the customer's words otherwise. */
export function jobHistoryLabels(template, prompt) {
  if (isUneditedTemplatePrompt(template, prompt)) {
    const title = presetTitle(template.name);
    return { prompt: title.slice(0, 60), name: title.slice(0, 40) };
  }
  return { prompt: prompt.slice(0, 60), name: prompt.slice(0, 40) };
}
