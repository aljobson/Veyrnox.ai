import { EFFECT_CONCEPTS } from './effectConceptCatalog.js';

const THEME_RECIPES = {
  PET: {
    category: 'YOUR PHOTO',
    needs: 'A clear photo of your pet or animal subject',
    direction: 'Keep the animal recognisable, expressive and anatomically natural while staging the idea with playful, believable motion.',
    negativePrompt: 'animal identity drift, malformed paws, duplicate animals, frightening behaviour, captions, logos, watermark',
  },
  STYLE: {
    category: 'FASHION',
    needs: 'A clear photo of the person, object or scene you want to restyle',
    direction: 'Apply a coherent original visual treatment while preserving the subject, composition and important identifying details.',
    negativePrompt: 'identity drift, inconsistent style, warped anatomy, unreadable details, captions, logos, watermark',
  },
  'QUIRK LAB': {
    category: 'UGC',
    needs: 'A clear starting photo with the main subject fully visible',
    direction: 'Treat the concept as a concise visual joke with one readable setup, one surprising turn and a clean final beat.',
    negativePrompt: 'identity drift, confusing action, duplicate subjects, malformed anatomy, captions, logos, watermark',
  },
  'MORPH ME': {
    category: 'YOUR PHOTO',
    needs: 'A clear portrait or full-body photo of the person to transform',
    direction: 'Build one smooth transformation around the subject while keeping their face, pose continuity and core identity recognisable.',
    negativePrompt: 'identity drift, face replacement, broken transformation, duplicate limbs, body horror, captions, logos, watermark',
  },
  'AI DANCE': {
    category: 'UGC',
    needs: 'A clear full-body photo with room around the performer',
    direction: 'Create an original short performance with readable rhythm, grounded footwork, natural balance and consistent clothing.',
    negativePrompt: 'identity drift, sliding feet, broken joints, duplicate dancers, unsafe movement, captions, logos, watermark',
  },
  'SOCCER FEVER': {
    category: 'REALISTIC',
    needs: 'A clear action-ready photo of the player or sporting subject',
    direction: 'Stage the sporting idea with convincing body mechanics, clear ball or prop contact, crowd energy and broadcast-quality framing.',
    negativePrompt: 'identity drift, impossible anatomy, missing equipment, broken contact, graphic injury, captions, logos, watermark',
  },
  'SUPER POWER': {
    category: 'VFX',
    needs: 'A clear photo of the subject and the environment around them',
    direction: 'Reveal the power through readable cause and effect, cinematic scale, consistent lighting and safe non-graphic spectacle.',
    negativePrompt: 'identity drift, graphic injury, uncontrolled destruction, muddy effects, malformed anatomy, captions, logos, watermark',
  },
  'E-COMMERCE': {
    category: 'PRODUCTS',
    needs: 'A clean product photo with the complete object and branding visible',
    direction: 'Preserve the product exactly and present the concept as a polished original commercial with controlled lighting and premium motion.',
    negativePrompt: 'product drift, altered branding, misspelled packaging, warped geometry, clutter, captions, watermark',
  },
  'SHOT LANGUAGE': {
    category: 'CINEMATIC',
    needs: 'A clear starting image with a strong subject and readable depth',
    direction: 'Make the named camera idea the focus of one smooth, spatially coherent shot with deliberate composition and natural parallax.',
    negativePrompt: 'camera shake, jump cuts, spatial discontinuity, identity drift, warped perspective, captions, logos, watermark',
  },
  'AI GIFT': {
    category: 'UGC',
    needs: 'A clear photo of the person, people or memory you want to celebrate',
    direction: 'Shape the idea into a warm, personal keepsake with respectful expressions, consistent identities and an emotionally clear ending.',
    negativePrompt: 'identity drift, invented private text, duplicate people, distorted faces, captions, logos, watermark',
  },
  FESTIVAL: {
    category: 'FANTASY',
    needs: 'A clear portrait or scene photo with space for celebratory details',
    direction: 'Create an original celebratory sequence with layered decorations, joyful motion and a strong final tableau without franchise imagery.',
    negativePrompt: 'identity drift, frightening imagery, crowd duplication, unreadable decorations, captions, logos, watermark',
  },
};

const STEPS = [
  'Upload a clear starting photo you have permission to use.',
  'Review the editable concept prompt and adjust the people, place, colours or action.',
  'Generate a 5s or 10s shot, or carry the idea into Film Studio for a longer sequence.',
];

function backgroundFor(id, theme) {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  const baseHue = {
    PET: 155, STYLE: 322, 'QUIRK LAB': 24, 'MORPH ME': 274, 'AI DANCE': 332,
    'SOCCER FEVER': 137, 'SUPER POWER': 214, 'E-COMMERCE': 34,
    'SHOT LANGUAGE': 217, 'AI GIFT': 348, FESTIVAL: 9,
  }[theme] ?? 220;
  const hue = (baseHue + (hash % 31) - 15 + 360) % 360;
  const second = (hue + 24 + (hash % 19)) % 360;
  return `linear-gradient(145deg,hsl(${hue} 58% 12%) 0%,hsl(${hue} 62% 34%) 56%,hsl(${second} 82% 68%) 100%)`;
}

export const EFFECT_CONCEPT_TEMPLATES = EFFECT_CONCEPTS.map((concept) => {
  const recipe = THEME_RECIPES[concept.theme] || THEME_RECIPES['QUIRK LAB'];
  const title = concept.name.toLocaleLowerCase('en');
  return {
    id: concept.id,
    name: concept.name,
    theme: concept.theme,
    model: 'Kling 3.0 · I2V',
    credits: 32,
    durationSeconds: 10,
    category: recipe.category,
    aspect: '9:16',
    previewAspect: '9 / 16',
    isNew: true,
    inspired: true,
    promptOrigin: 'veyrnox-adaptation',
    bg: backgroundFor(concept.id, concept.theme),
    needs: recipe.needs,
    prompt: `Animate the uploaded starting image into a polished ten-second original video interpretation of the “${title}” concept. ${recipe.direction} Preserve the main subject's identity, proportions, clothing colours and relationship to the setting from start to finish. Use smooth cinematic movement, stable anatomy, natural contact shadows and a decisive final composition. Add no captions, logos, copied characters or watermark.`,
    negativePrompt: recipe.negativePrompt,
    steps: STEPS,
  };
});
