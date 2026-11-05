import { COMMUNITY_300_RECIPES } from './sourceTemplateExpansion14Data.js';

const base = {
  model: 'Kling 3.0 · I2V', credits: 32, durationSeconds: 10,
  isNew: true, inspired: true,
};
const steps = [
  'Upload a clear starting image that matches the subject guidance.',
  'Use this template to load its editable ten-second prompt and settings.',
  'Generate a 5s or 10s shot, or continue in Film Studio for a longer multi-shot film.',
];
export const HIGGSFIELD_300_TEMPLATE_IDS = Object.freeze(COMMUNITY_300_RECIPES.map(({ id }) => id));
export const SOURCE_TEMPLATE_EXPANSION_14 = COMMUNITY_300_RECIPES.map(({ group, ...recipe }) => ({
  ...base, ...recipe, clipKey: recipe.id, steps,
  needsKey: group ? 'community.group' : 'community.cinematic',
  needs: group ? 'One starting image containing every subject in their intended positions' : 'A clear full-body portrait with room for cinematic movement',
  bg: 'linear-gradient(155deg,#121722 0%,#394c66 55%,#b77d62 100%)',
}));
export const SHOWCASE_CLIP_EXPANSION_14 = Object.fromEntries(SOURCE_TEMPLATE_EXPANSION_14.map((entry) => [entry.clipKey, {
  video: `/showcase/creator-${entry.id}.mp4`, poster: `/showcase/creator-${entry.id}.jpg`,
  aspectRatio: entry.previewAspect, title: entry.name.toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase()),
}]));
