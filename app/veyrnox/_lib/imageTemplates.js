import { SYNTX_100_IMAGE_TEMPLATES } from './imageTemplatesSyntx100.js';
import { IMAGE_SOURCE_PROMPT_RECORDS } from './imageSourcePromptRecords.js';

import { imageTemplatesEnabled } from './imageTemplatesFlag.js';
export { imageTemplatesEnabled } from './imageTemplatesFlag.js';

const CHRISTMAS_IMAGE_TEMPLATES = [
  { id: 'flying-elf', name: 'FLYING ELF', model: 'nano-banana-kie', aspect: '16:9',
    prompt: IMAGE_SOURCE_PROMPT_RECORDS['flying-elf'].prompt, promptOrigin: 'community-source-exact' },
  { id: 'christmas-tree-ornament', name: 'CHRISTMAS TREE ORNAMENT', model: 'nano-banana-pro-edit-grsai', aspect: '3:4',
    photo: Object.freeze({ required: true, count: 1 }),
    prompt: IMAGE_SOURCE_PROMPT_RECORDS['christmas-tree-ornament'].prompt, promptOrigin: 'community-source-exact' },
].map((template) => Object.freeze({
  ...template, kind: 'image', category: 'CHRISTMAS', isNew: true,
  previewAspect: template.aspect.replace(':', ' / '),
  previewImage: `/showcase/christmas/${template.id}.webp`,
  bg: 'linear-gradient(145deg, #163d35, #702e35 65%, #c59a54)',
}));

export const IMAGE_TEMPLATES = Object.freeze([...CHRISTMAS_IMAGE_TEMPLATES, ...SYNTX_100_IMAGE_TEMPLATES]);

export const isImageTemplate = (template) => template?.kind === 'image';
export function publishedImageTemplates() {
  return imageTemplatesEnabled() ? IMAGE_TEMPLATES.filter(isImageTemplate) : [];
}
