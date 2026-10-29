const base = {
  model: 'Kling 3.0 · I2V', credits: 32, durationSeconds: 10,
  isNew: true, inspired: true, promptOrigin: 'veyrnox-adaptation',
  negativePrompt: 'identity drift, warped anatomy, extra limbs, flicker, captions, logos, watermark',
};
const steps = [
  'Upload a clear starting image that matches the subject guidance.',
  'Use this template to load its editable ten-second prompt and settings.',
  'Generate a 5s or 10s shot, or continue in Film Studio for a longer multi-shot film.',
];
const recipes = [
  [
    "god-of-war",
    "GOD OF WAR",
    "VFX",
    "406 / 720",
    false
  ],
  [
    "basketball-2",
    "BASKETBALL 2",
    "VFX",
    "406 / 720",
    true
  ],
  [
    "tesla-object-replace",
    "TESLA OBJECT REPLACE",
    "PRODUCTS",
    "540 / 720",
    false
  ],
  [
    "playing-chess-with-tesla",
    "PLAYING CHESS WITH TESLA",
    "REALISTIC",
    "406 / 720",
    false
  ],
  [
    "tesla-lose-control",
    "TESLA LOSE CONTROL",
    "FANTASY",
    "960 / 720",
    true
  ],
  [
    "fly-over-the-teslas",
    "FLY OVER THE TESLA'S",
    "REALISTIC",
    "1280 / 720",
    false
  ],
  [
    "desire-mode",
    "DESIRE MODE",
    "FASHION",
    "960 / 720",
    true
  ],
  [
    "license-registration-liftoff",
    "LICENSE, REGISTRATION… LIFTOFF",
    "REALISTIC",
    "406 / 720",
    true
  ],
  [
    "tesla-started-something",
    "TESLA STARTED SOMETHING",
    "REALISTIC",
    "540 / 720",
    false
  ],
  [
    "coliseum-drift",
    "COLISEUM DRIFT",
    "MOVIES",
    "960 / 720",
    true
  ],
  [
    "and-i-need-you",
    "AND I NEED YOU",
    "MOVIES",
    "1280 / 720",
    true
  ],
  [
    "just-a-lit-bit",
    "JUST A LIT BIT",
    "REALISTIC",
    "406 / 720",
    true
  ],
  [
    "i-am-here",
    "I AM HERE",
    "REALISTIC",
    "406 / 720",
    true
  ],
  [
    "somebody",
    "SOMEBODY",
    "MOVIES",
    "854 / 480",
    true
  ],
  [
    "sega",
    "SEGA",
    "FASHION",
    "406 / 720",
    true
  ],
  [
    "theater-ceiling-horror",
    "THEATER CEILING HORROR",
    "MOVIES",
    "540 / 720",
    false
  ],
  [
    "studio-ballerina-turns",
    "STUDIO BALLERINA TURNS",
    "FASHION",
    "540 / 720",
    false
  ],
  [
    "little-storm-knight",
    "LITTLE STORM KNIGHT",
    "FANTASY",
    "960 / 720",
    true
  ],
  [
    "wear-the-moment",
    "WEAR THE MOMENT",
    "PRODUCTS",
    "406 / 720",
    true
  ],
  [
    "wassup-freestyle",
    "WASSUP FREESTYLE",
    "VFX",
    "1280 / 720",
    false
  ],
  [
    "piano-vibe",
    "PIANO VIBE",
    "VFX",
    "1280 / 720",
    false
  ],
  [
    "you-good-max",
    "YOU GOOD, MAX?",
    "VFX",
    "406 / 720",
    false
  ],
  [
    "reflection-in-the-mirror",
    "REFLECTION IN THE MIRROR",
    "VFX",
    "406 / 720",
    false
  ],
  [
    "car-blows-up",
    "CAR BLOWS UP",
    "VFX",
    "406 / 720",
    true
  ],
  [
    "saved-by-darkness",
    "SAVED BY DARKNESS",
    "MOVIES",
    "1280 / 720",
    true
  ],
  [
    "pumpkin-guardian",
    "PUMPKIN GUARDIAN",
    "FANTASY",
    "406 / 720",
    false
  ],
  [
    "fashion-halloween",
    "FASHION HALLOWEEN",
    "FANTASY",
    "406 / 720",
    false
  ],
  [
    "thrille",
    "THRILLE",
    "FANTASY",
    "1280 / 720",
    false
  ],
  [
    "ghost-makeover",
    "GHOST MAKEOVER",
    "FANTASY",
    "406 / 720",
    false
  ],
  [
    "cash-flow",
    "CASH FLOW",
    "VFX",
    "406 / 720",
    false
  ],
  [
    "cliffside-silence",
    "CLIFFSIDE SILENCE",
    "VFX",
    "406 / 720",
    false
  ],
  [
    "icon-duet",
    "ICON DUET",
    "VFX",
    "406 / 720",
    true
  ],
  [
    "raindance",
    "RAINDANCE",
    "VFX",
    "1050 / 720",
    true
  ],
  [
    "kieza-dance-flow",
    "KIEZA DANCE FLOW",
    "VFX",
    "406 / 720",
    true
  ],
  [
    "call-the-car",
    "CALL THE CAR",
    "VFX",
    "406 / 720",
    true
  ],
  [
    "haunted-motion",
    "HAUNTED MOTION",
    "VFX",
    "406 / 720",
    false
  ],
  [
    "my-other-hobby",
    "MY OTHER HOBBY",
    "REALISTIC",
    "540 / 720",
    false
  ],
  [
    "one-last-embrace",
    "ONE LAST EMBRACE",
    "MOVIES",
    "1280 / 720",
    true
  ],
  [
    "lil-yachti-coffin",
    "LIL YACHTI COFFIN",
    "VFX",
    "1280 / 720",
    false
  ],
  [
    "birthday-drift",
    "BIRTHDAY DRIFT",
    "VFX",
    "406 / 720",
    true
  ]
];
export const SYNTX_40_TEMPLATE_IDS = Object.freeze(recipes.map(([id]) => id));
export const SOURCE_TEMPLATE_EXPANSION_11 = recipes.map(([id, name, category, previewAspect, group]) => ({
  ...base, id, name, category, previewAspect, clipKey: id, steps,
  needsKey: group ? 'community.group' : 'community.cinematic',
  needs: group ? 'One starting image containing every subject in their intended positions' : 'A clear full-body portrait with room for cinematic movement',
  bg: 'linear-gradient(155deg,#111923 0%,#455669 55%,#c99672 100%)',
  prompt: `Animate the uploaded reference into an original ten-second ${name.toLowerCase()} sequence based on the verified source concept. Preserve every supplied subject's recognizable identity, design, proportions, materials, colours, clothing and role throughout. Keep anatomy and object geometry stable, physical contact coherent and motion naturally weighted. Use controlled camera movement, consistent lighting and no captions, logos or watermark.`,
}));
export const SHOWCASE_CLIP_EXPANSION_11 = Object.fromEntries(SOURCE_TEMPLATE_EXPANSION_11.map((entry) => [entry.clipKey, {
  video: `/showcase/viral-${entry.id}.mp4`, poster: `/showcase/viral-${entry.id}.jpg`,
  aspectRatio: entry.previewAspect, title: entry.name.toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase()),
}]));
