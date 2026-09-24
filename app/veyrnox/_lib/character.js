// Character builder: grouped traits turned into one portrait prompt.
// Option lists ported from Open-Generative-AI's AiInfluencerStudio.jsx (MIT,
// Copyright (c) Anil Matcha). Two changes: origin options say "... heritage"
// rather than upstream's "Scandinavian Supermodel" / "K-Pop Idol phenotype",
// and the base prompt always asks for an original adult, not a real person
// (Terms: no minors, no deepfakes). Client-side only: it changes the prompt,
// never the model or the price.

export const CHARACTER_TABS = ['Face', 'Body', 'Style'];

// { id, tab, label, options: [label, prompt phrase][] }
export const CHARACTER_GROUPS = [
  { id: 'character_type', tab: 'Face', label: 'Character Type', options: [
      ['Human', 'human features'],
      ['Elf', 'elf with pointed ears'],
      ['Alien', 'alien creature'],
      ['Amphibian', 'amphibian humanoid'],
      ['Reptile', 'reptilian creature'],
      ['Mantis', 'mantis hybrid character'],
      ['Bee', 'bee insect hybrid character'],
      ['Octopus', 'aquatic octopus hybrid'],
      ['Crocodile', 'crocodile humanoid'],
      ['Iguana', 'iguana humanoid'],
      ['Lizard', 'lizard humanoid'],
      ['Beetle', 'rhinoceros beetle humanoid'],
      ['Ant', 'ant hybrid character'],
  ] },
  { id: 'gender', tab: 'Face', label: 'Gender', options: [
      ['Female', 'female'],
      ['Male', 'male'],
      ['Non-binary', 'non-binary character'],
      ['Trans Man', 'transgender man'],
      ['Trans Woman', 'transgender woman'],
  ] },
  { id: 'ethnicity_origin_base', tab: 'Face', label: 'Ethnicity / Origin', options: [
      ['African', 'african heritage'],
      ['Asian', 'east asian heritage'],
      ['European', 'european heritage'],
      ['Indian', 'south asian indian heritage'],
      ['Middle Eastern', 'middle eastern heritage'],
      ['Mixed', 'multiracial mixed heritage'],
  ] },
  { id: 'eye_color', tab: 'Face', label: 'Eye Color', options: [
      ['Blue', 'striking blue eyes'],
      ['Brown', 'warm brown eyes'],
      ['Green', 'emerald green eyes'],
      ['Amber', 'amber eyes'],
      ['Grey', 'grey eyes'],
      ['Red', 'red eyes'],
      ['Purple', 'violet purple eyes'],
      ['Black', 'black eyes'],
      ['Deep Brown', 'deep dark brown eyes'],
      ['White', 'white eyes'],
      ['Solid Black', 'solid black void eyes'],
      ['Blind / Empty', 'blind empty white eyes'],
  ] },
  { id: 'eyes_type', tab: 'Face', label: 'Eye Type', options: [
      ['Human', 'normal human eyes'],
      ['Reptile', 'reptile slit-pupil eyes'],
      ['Mechanical', 'mechanical cyborg eyes'],
  ] },
  { id: 'eyes_details', tab: 'Face', label: 'Eye Features', options: [
      ['Heterochromia', 'heterochromia different eye colors'],
      ['Blind Eye', 'one cloudy blind eye'],
      ['Scarred Eye', 'scar running across one eye'],
      ['Glowing Eye', 'glowing magical eyes'],
  ] },
  { id: 'mouth', tab: 'Face', label: 'Mouth & Teeth', options: [
      ['Small Mouth', 'small delicate mouth'],
      ['Large Mouth', 'wide expressive mouth'],
      ['No Teeth', 'no visible teeth'],
      ['Unique Teeth', 'unusual tooth structure'],
      ['Sharp Teeth', 'sharp predatory fangs'],
      ['Forked Tongue', 'reptilian forked tongue'],
      ['Two Tongues', 'two separate tongues'],
  ] },
  { id: 'ears', tab: 'Face', label: 'Ears', options: [
      ['Human', 'normal human ears'],
      ['Elf Ears', 'pointed elf ears'],
      ['No Ears', 'no visible ears'],
      ['Wing Ears', 'wing ears'],
  ] },
  { id: 'horns', tab: 'Face', label: 'Horns', options: [
      ['Small Horns', 'small horns on forehead'],
      ['Big Horns', 'large curved horns'],
      ['Antlers', 'deer antlers on head'],
  ] },
  { id: 'skin_conditions', tab: 'Face', label: 'Skin Conditions', options: [
      ['Vitiligo', 'vitiligo skin condition'],
      ['Pigmentation', 'hyperpigmentation'],
      ['Freckles', 'freckled skin'],
      ['Birthmarks', 'visible birthmarks'],
      ['Scars', 'scarred skin'],
      ['Burns', 'burn marks on skin'],
      ['Albinism', 'albinism pale white skin'],
      ['Cracked Skin', 'cracked dry skin texture'],
      ['Wrinkled', 'wrinkled aged skin'],
  ] },
  { id: 'face_skin_material', tab: 'Body', label: 'Face Skin Material', options: [
      ['Human Skin', 'smooth human skin'],
      ['Scales', 'shimmering scales'],
      ['Fur', 'soft fur covered face'],
      ['Amphibian', 'smooth moist amphibian skin'],
      ['Fish Skin', 'iridescent fish scale skin'],
      ['Metallic', 'polished metallic skin'],
  ] },
  { id: 'face_surface_pattern', tab: 'Body', label: 'Skin Pattern', options: [
      ['Solid', 'solid color skin'],
      ['Stripes', 'exotic striped skin pattern'],
      ['Spots', 'dappled spotted skin'],
      ['Chess', 'checkerboard skin pattern'],
      ['Veins', 'translucent skin with neon veins'],
      ['Gradient', 'gradient skin coloring'],
      ['Giraffe', 'giraffe print skin markings'],
  ] },
  { id: 'body_type', tab: 'Body', label: 'Body Type', options: [
      ['Slim', 'slim slender physique'],
      ['Lean', 'lean toned physique'],
      ['Athletic', 'fit athletic body'],
      ['Muscular', 'strong muscular build'],
      ['Curvy', 'curvy body type'],
      ['Heavy', 'heavy set build'],
      ['Skinny', 'very skinny thin build'],
  ] },
  { id: 'left_arm', tab: 'Body', label: 'Left Arm', options: [
      ['Normal', 'normal left arm'],
      ['Cute Prosthetic', 'stylish pink prosthetic left arm with cute stickers'],
      ['Robotic', 'robotic left arm'],
      ['Prosthetic', 'prosthetic left arm'],
      ['Mechanical', 'mechanical left arm'],
      ['None', 'no left arm'],
  ] },
  { id: 'right_arm', tab: 'Body', label: 'Right Arm', options: [
      ['Normal', 'normal right arm'],
      ['Cute Prosthetic', 'stylish pink prosthetic right arm with cute stickers'],
      ['Robotic', 'robotic right arm'],
      ['Prosthetic', 'prosthetic right arm'],
      ['Mechanical', 'mechanical right arm'],
      ['None', 'no right arm'],
  ] },
  { id: 'left_leg', tab: 'Body', label: 'Left Leg', options: [
      ['Normal', 'normal left leg'],
      ['Cute Prosthetic', 'stylish pink prosthetic left leg with cute stickers'],
      ['Robotic', 'robotic left leg'],
      ['Prosthetic', 'prosthetic left leg'],
      ['Mechanical', 'mechanical left leg'],
      ['None', 'no left leg'],
  ] },
  { id: 'right_leg', tab: 'Body', label: 'Right Leg', options: [
      ['Normal', 'normal right leg'],
      ['Cute Prosthetic', 'stylish pink prosthetic right leg with cute stickers'],
      ['Robotic', 'robotic right leg'],
      ['Prosthetic', 'prosthetic right leg'],
      ['Mechanical', 'mechanical right leg'],
      ['None', 'no right leg'],
  ] },
  { id: 'hair', tab: 'Style', label: 'Hair / Head Growth', options: [
      ['Bald', 'bald head'],
      ['Short Hair', 'short hair'],
      ['Long Hair', 'long flowing hair'],
      ['Afro', 'afro hairstyle'],
      ['Punk', 'punk mohawk hairstyle'],
      ['Fur / Mane', 'fur mane on head'],
      ['Tentacles', 'tentacles as hair'],
      ['Spines', 'spines as hair'],
  ] },
  { id: 'accessories', tab: 'Style', label: 'Accessories & Markings', options: [
      ['Tattoos', 'covered in tattoos'],
      ['Piercings', 'multiple piercings'],
      ['Scarification', 'ritual scarification marks'],
      ['Symbols / Markings', 'symbolic tribal markings'],
      ['Cyber Markings', 'cyberpunk circuit markings'],
  ] },
  { id: 'rendering_style', tab: 'Style', label: 'Rendering Style', options: [
      ['Hyper-Realistic', 'hyper-realistic 8k photograph'],
      ['Anime', 'anime art style'],
      ['Cartoon', 'cartoon illustration style'],
      ['2D Illustration', '2D flat illustration style'],
  ] },
];

export const CHARACTER_BASE = 'Portrait of an original adult character, not a real person, cinematic lighting, sharp detail';

// The gateway refuses a prompt over 2000 characters (lib/modelCapabilities.js).
const PROMPT_MAX = 2000;

/** The phrases for the chosen options ({ groupId: optionLabel }); unknown picks add nothing. */
export function characterTraits(picks) {
  const parts = [];
  for (const g of CHARACTER_GROUPS) {
    const hit = g.options.find(([label]) => label === (picks || {})[g.id]);
    if (hit) parts.push(hit[1]);
  }
  return parts;
}

/**
 * Base portrait, the chosen traits, then the user's own text. The user's text
 * is what gets cut to fit the gateway limit, never the character.
 */
export function buildCharacterPrompt(userText, picks) {
  const head = [CHARACTER_BASE, ...characterTraits(picks)].join(', ');
  const extra = String(userText || '').trim();
  if (!extra) return head.slice(0, PROMPT_MAX);
  return `${head}, ${extra}`.slice(0, PROMPT_MAX);
}
