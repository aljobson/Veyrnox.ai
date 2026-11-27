import { GENERATION_PROMPT_MAX } from '../../../lib/generationPromptLimits.js';

/**
 * Explain why a linked template cannot safely move to another Create model.
 * Linked templates stay on the model whose reference was reviewed. A different
 * provider can reinterpret the same prompt so heavily that a successful job no
 * longer resembles the preview; that is a fresh custom run, not a template run.
 */
export function templateModelSwapIssue({ template, templateModel, targetModel, prompt }) {
  if (!template || !templateModel || !targetModel || templateModel.id === targetModel.id) return null;

  const max = targetModel.takesTopic ? 200 : targetModel.promptMax || GENERATION_PROMPT_MAX;
  const count = String(prompt || '').trim().length;
  if (count > max) return { code: 'prompt-too-long', count, max };

  if (templateModel.kind === 'audio' && targetModel.kind === 'audio'
    && Boolean(templateModel.isSpeech) !== Boolean(targetModel.isSpeech)) {
    return { code: 'audio-purpose' };
  }

  return { code: 'template-model' };
}
