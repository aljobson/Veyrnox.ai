import { helperExceptions } from './helper-i18n-exceptions.mjs';

// Named data fields only. New prose in these modules is still inventoried.
export function dataException({ file, owner, field, text, templateFile }) {
  if (file === 'app/veyrnox/_lib/guides.js' && owner === 'GUIDES' && field === 'answer') return 'English-only lead: guides/[id]/page.js renders it only when the locale is en, so no other language shows untranslated text; translating it is a separate follow-up.';
  if (file === 'app/veyrnox/_lib/seedanceReference.js' && ['SEEDANCE_REFERENCE_MODEL','FRAME_MODEL'].includes(owner)) return 'Fixed provider model identity used to route Seedance reference templates; never translated (ADR-0309).';
  if (file === 'app/veyrnox/_lib/seedanceTemplateMetadata.js' && owner === 'SEEDANCE_200_TEMPLATE_METADATA' && field === 'runnableModel' && text === 'Kling 3.0 · I2V') return 'Fixed provider model identity used to route source recipes; never translated.';
  if (file === 'app/veyrnox/_lib/referenceTemplates.js' && ((owner === 'REFERENCE_TEMPLATES' && field === 'prompt') || (owner === 'COMMON' && field === 'model' && text === 'Kling O1 · Reference'))) return 'Canonical provider prompt or fixed model identity; reference recipe display guidance remains audited (ADR-0301).';
  if (file.endsWith('/genjutsuSourcePromptRecords.js') && owner === 'GENJUTSU_SOURCE_PROMPT_RECORDS' && field === 'prompt') return 'Exact published community source prompt shown read-only for provenance; never translated (ADR-0107).';
  if (file.endsWith('/higgsfieldCommunityExpansion90Records.js') && owner === 'HIGGSFIELD_90_SOURCE_PROMPT_RECORDS' && field === 'prompt') return 'Exact published community source prompt shown read-only for same-record provenance; never translated (ADR-0107).';
  if (['/higgsfieldReplacementRecords.js', '/syntxReplacementRecords.js'].some(suffix => file.endsWith(suffix)) && ['HF_REPLACEMENTS_RECORDS', 'SYNTX_REPLACEMENTS_RECORDS'].includes(owner) && ['prompt', 'sourceTitle'].includes(field)) return 'Exact same-record community text and title; never translated (ADR-0325 Amendment 2).';
  if (file.endsWith('/higgsfieldCategoryFillRecords.js') && owner === 'HIGGSFIELD_CATEGORY_FILL_RECORDS' && ['prompt','sourceTitle'].includes(field)) return 'Exact same-record community text and title; never translated (ADR-0325).';
  if (file.endsWith('/higgsfieldCommunityExpansion300Records.js') && owner === 'HIGGSFIELD_300_SOURCE_PROMPT_RECORDS' && ['prompt','sourceTitle'].includes(field)) return 'Exact published community source provenance from the same record; never translated (ADR-0107).';
  if (file.endsWith('/syntxSourcePromptRecords.js') && ['SYNTX_BASE_SOURCE_PROMPT_RECORDS','SYNTX_SOURCE_PROMPT_RECORDS'].includes(owner) && ['prompt','sourceTitle'].includes(field)) return 'Exact published community source provenance; never translated (ADR-0107).';
  if (file.endsWith('/syntxSourcePromptExpansionRecords.js') && owner === 'SYNTX_SOURCE_PROMPT_EXPANSION_RECORDS' && ['prompt','sourceTitle'].includes(field)) return 'Exact published community source provenance; never translated (ADR-0107).';
  if (file.endsWith('/syntxSourcePromptExpansion64Records.js') && owner === 'SYNTX_64_SOURCE_PROMPT_RECORDS' && ['prompt','sourceTitle'].includes(field)) return 'Exact captured community text and title; never translated (ADR-0107).';
  if (file.endsWith('/syntxSourcePromptExpansion40Records.js') && owner === 'SYNTX_SOURCE_PROMPT_EXPANSION_40_RECORDS' && ['prompt','sourceTitle'].includes(field)) return 'Exact published community source provenance; never translated (ADR-0107).';
  if (file.endsWith('/seedanceSourcePromptRecords.js') && owner === 'SEEDANCE_SOURCE_PROMPT_RECORDS' && ['prompt','sourceTitle'].includes(field)) return 'Exact published Seedance community source provenance; never translated (ADR-0107).';
  if (/\/sourceTemplateExpansion\d*\.js$/.test(file) && /SHOWCASE_CLIP/.test(owner) && field === 'title') return 'Canonical showcase title; never translated (ADR-0107).';
  if (file.endsWith('/sourceTemplateExpansion14Data.js') && owner === 'COMMUNITY_300_RECIPES' && field === 'name') return 'Canonical searchable template title retained as source catalog data (ADR-0107).';
  if (file.endsWith('/effectConceptCatalog.js') && owner === 'EFFECT_CONCEPTS' && field === 'name') return 'Canonical searchable effect title retained as source catalog data (ADR-0107).';
  if (file.endsWith('/effectConceptTemplates.js') && owner === 'THEME_RECIPES' && field === 'direction') return 'Canonical model instruction interpolated into the editable generated prompt (ADR-0107).';
  if (file.endsWith('/tools.js') && owner === 'TOOL_TASKS' && field === 'blurb' && text === "Match a video's lips to new speech.") return 'tools/page.js uses tools.t.lipsync.blurb; source fallback differs only in apostrophe typography from the existing English catalog.';
  if (file.endsWith('/_lib/audioTemplates.js') && owner === 'AUDIO_TEMPLATES') return 'Original audio template prompt sent verbatim to the model, and its catalog name; never mutated for display (ADR-0107).';
  if (templateFile && ['prompt','negativePrompt','promptOrigin','model','name'].includes(field)) return 'Exact model input, provenance or catalog name; templates are never mutated for display.';
  if (/\/_lib\/tokens\.js$/.test(file) && owner === 'MODELS' && field === 'name') return 'Provider model name; stable catalog identity.';
  if (/\/_lib\/showcase\.js$/.test(file) && ['SHOWCASE_CLIPS', 'AUDIT_SHOWCASE_CLIPS'].includes(owner) && field === 'title') return 'Film title from the source showcase catalog; proper title remains unchanged.';
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
  if (/\/_lib\/(?:studioSkillIcons|studioWorkflows)\.js$/.test(file) && field === 'path' && /^[Mm][MmZzLlHhVvCcSsQqTtAaEe\d., +\-]+$/.test(text)) return 'Validated SVG path geometry.';
  return helperExceptions.find(rule => (!rule.file || rule.file.test(file)) && rule.pattern.test(text))?.reason;
}
