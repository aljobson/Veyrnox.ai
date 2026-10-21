import { tOr } from './translate.mjs';

// Stable sentence keys shared by all recipes; never changes the source array.
export const PRESET_STEP_KEYS = {
  "Upload a clean product image with the complete object visible.": "upload-product",
  "Use this template to load the ten-second orbit prompt and settings.": "load-orbit",
  "Review the product name and branding in the prompt before generating.": "review-branding",
  "Use this template to load the miniature-crew prompt and settings.": "load-miniature-crew",
  "Prepare your starting image using the guidance above.": "prepare-image",
  "Use this template to load its prompt and settings in the studio.": "load-studio",
  "Upload your image, edit the prompt if needed, and review the price before generating.": "upload-edit-review",
  "Upload a clear starting image that matches the subject guidance.": "upload-start",
  "Use this template to load its ten-second prompt and settings.": "load-ten-second",
  "Review the framing and identity details before generating.": "review-framing",
  "Use this template to load its editable ten-second prompt and settings.": "load-editable",
  "Generate a 5s or 10s shot, or continue in Film Studio for a longer multi-shot film.": "generate-or-film",
  "Upload a clear birthday portrait or party photo you have permission to use.": "upload-birthday",
  "Edit the age, colours and party details in the ten-second prompt.": "edit-birthday",
  "Generate a 5s or 10s shot, or build a 30–120s multi-shot birthday film in Film Studio.": "generate-birthday"
};

export function presetStep(t, step) {
  return tOr(t, `presets.steps.${PRESET_STEP_KEYS[step]}`, step);
}
