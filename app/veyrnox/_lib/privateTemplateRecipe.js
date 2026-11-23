import { templateRecipe } from './templateRecipe.js';
import { templateDetail } from '../../../lib/clientTemplates.js';
import { withoutPromptText } from '../../../lib/templatePromptPrivacy.js';

/**
 * The recipe a /presets/:id page hands its client components while templatePromptsPrivate is on (ADR-0351 amendment 23): the recipe's own
 * fields with the prompt texts swapped for placeholders, and the contract the way GET /api/templates/:id answers it, so photo slots
 * and fidelity work without the text. Title, model, inputs and steps are untouched.
 */
export function privateTemplateRecipe(template) {
  const recipe = withoutPromptText(templateRecipe(template));
  const fidelity = templateDetail(template.id, { hidePrompt: true })?.fidelity;
  return fidelity ? { ...recipe, fidelity } : recipe;
}
