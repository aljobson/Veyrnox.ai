import { helperExceptions } from './helper-i18n-exceptions.mjs';

// Named data fields only. New prose in these modules is still inventoried.
export function dataException({ file, owner, field, text, templateFile }) {
  if (file.endsWith('/sourceTemplateExpansion.js') && owner === 'SOURCE_TEMPLATE_EXPANSION' && field === 'description') return 'Unused provenance description: effectTemplate destructures neither description nor a spread; no returned template or renderer receives it.';
  if (file.endsWith('/sourceTemplateExpansion5.js') && owner === 'recipes' && field === 'action') return 'Canonical action interpolated into the provider prompt by the birthday recipe factory.';
  if (file.endsWith('/tools.js') && owner === 'TOOL_TASKS' && field === 'blurb' && text === "Match a video's lips to new speech.") return 'tools/page.js uses tools.t.lipsync.blurb; source fallback differs only in apostrophe typography from the existing English catalog.';
  if (templateFile && ['prompt','negativePrompt','promptOrigin','model','name'].includes(field)) return 'Exact model input, provenance or catalog name; templates are never mutated for display.';
  if (templateFile && owner === 'base' && field === 'negativePrompt') return 'Provider negative prompt shared by the template factory.';
  if (/\/_lib\/tokens\.js$/.test(file) && owner === 'MODELS' && field === 'name') return 'Provider model name; stable catalog identity.';
  if (/\/_lib\/showcase\.js$/.test(file) && owner === 'SHOWCASE_CLIPS' && field === 'title') return 'Film title from the source showcase catalog; proper title remains unchanged.';
  if (/\/_lib\/character\.js$/.test(file) && owner === 'CHARACTER_BASE') return 'Canonical character generation prompt.';
  if (/\/_lib\/editorGeneration\.mjs$/.test(file) && ['CAMERA_MOVEMENTS','MOVEMENT_PACES'].includes(owner) && field === 'direction') return 'Camera direction appended to model prompts, never translated.';
  if (/\/_lib\/cinema\.js$/.test(file) && owner === 'CAMERAS') return 'Camera descriptor appended to the provider prompt by cinemaSuffix.';
  if (/\/_lib\/promptBox\.js$/.test(file) && owner === 'STARTER_PROMPT') return 'Editable sample prompt sent verbatim to the model.';
  if (file === 'lib/veyJourney.js' && owner === 'MOTION_DRAFT') return 'Canonical motion prompt used for the creation handoff.';
  if (/\/_lib\/(?:studioSkills|filmStudioAssistants)\.js$/.test(file) && ['SKILLS','FILM_ASSISTANTS'].includes(owner) && field === 'body') return 'Assistant system instructions; displayed names, descriptions and starters use app catalogs.';
  if (/\/_lib\/oddlingStudio\.js$/.test(file) && owner === 'ODDLING_SCENES') return 'Editable scene prompt: OddlingStudio shows numbered scene buttons and sends canonical text to the model.';
  if (/\/_lib\/oddlingStudio\.js$/.test(file) && owner === 'ODDLING_STUDIO_SECTIONS' && field === 'hint') return 'No UI consumer: lib/oddlingKnowledge.js embeds these in canonical assistant retrieval data (ADR-0107 C2).';
  if (/\/_lib\/oddlingFeatureCharacters\.js$/.test(file) && owner === 'ODDLING_FEATURE_SOURCES' && field === 'label') return 'Canonical preset collection titles retained under ADR-0107; not the translated category hints.';
  if (/\/_lib\/oddlingCatalog\.js$/.test(file) && owner === 'CATEGORY_ICONS' && /^[Mm][MmZzLlHhVvCcSsQqTtAaEe\d., +\-]+$/.test(text)) return 'Validated SVG path geometry.';
  return helperExceptions.find(rule => (!rule.file || rule.file.test(file)) && rule.pattern.test(text))?.reason;
}
