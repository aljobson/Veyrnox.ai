const base = {
  credits: 32,
  durationSeconds: 10,
  isNew: true,
  inspired: true,
  promptOrigin: 'veyrnox-adaptation',
  negativePrompt: 'identity drift, warped anatomy, duplicate subjects, flicker, jump cuts, captions, logos, watermark',
};

const steps = [
  'Upload a clear starting image that matches the subject guidance.',
  'Use this template to load its editable ten-second prompt and settings.',
  'Generate a 5s or 10s shot, or continue in Film Studio for a longer multi-shot film.',
];

const looks = [
  ['race-track', 'RACE TRACK', 'VFX', '9 / 16', '9:16', 'a full-body portrait with room around the subject', 'Place the subject on a stylised race circuit as a camera races beside them, track markings streak past and a final overhead move reveals the complete course.'],
  ['modern-montage', 'MODERN MONTAGE', 'ADS', '16 / 9', '16:9', 'a clean product or creator portrait', 'Build a crisp modern editorial montage with geometric crops, bold white space, sliding panels and rhythmic match cuts that preserve the subject across every layout.'],
  ['vintage-montage', 'VINTAGE MONTAGE', 'CINEMATIC', '16 / 9', '16:9', 'a portrait or product image with strong central framing', 'Transform the scene through warm analogue film frames, optical light leaks, aged paper edges and tactile jump cuts while the subject remains recognisable.'],
  ['action-figure', 'ACTION FIGURE', 'PRODUCTS', '9 / 16', '9:16', 'a full-body portrait with a clear silhouette', 'Turn the person into a collectible figure inside premium display packaging, then let the figure step out of the box and strike one confident pose.'],
  ['paper-world', 'PAPER WORLD', 'CARTOONS', '16 / 9', '16:9', 'a clearly separated person, object or landscape', 'Rebuild the whole scene from folded paper layers, visible fibres and cut edges, then move the camera through the miniature paper environment.'],
  ['broken-mirror', 'BROKEN MIRROR', 'VFX', '4 / 3', '16:9', 'a close portrait facing the camera', 'Split the portrait across floating mirror shards, let each reflection move with coherent parallax, then draw the pieces back into one flawless image.'],
  ['puffin-flight', 'PUFFIN FLIGHT', 'FANTASY', '1 / 1', '1:1', 'a full-body outdoor portrait with a clear face', 'Place the subject astride a giant friendly puffin gliding above sea cliffs, with believable grip, wind, feather motion and an energetic aerial camera.'],
  ['three-d-render', '3D RENDER', 'CARTOONS', '9 / 16', '9:16', 'a clear portrait or character design', 'Convert the subject into a polished three-dimensional character, rotate studio lights around them and reveal sculpted materials without changing their identity.'],
  ['orbital-presence', 'ORBITAL PRESENCE', 'VFX', '9 / 16', '9:16', 'a full-body portrait in an open setting', 'Suspend luminous rings and small celestial objects around the subject while the camera makes one smooth orbit and every element follows coherent depth and shadow.'],
  ['hand-painted', 'HAND PAINTED', 'CARTOONS', '16 / 9', '16:9', 'a portrait or landscape with strong shapes', 'Sweep visible brush strokes across the frame until the scene becomes a moving hand-painted artwork, retaining the subject beneath layered pigment and canvas texture.'],
  ['origami-fold', 'ORIGAMI FOLD', 'CARTOONS', '16 / 9', '16:9', 'a person or object against a simple background', 'Fold the scene into precise origami planes, animate the paper figure through one elegant movement and unfold it back into the original image.'],
  ['orbit-360', 'ORBIT 360', 'CINEMATIC', '9 / 16', '9:16', 'a full-body subject with an uncluttered background', 'Circle the subject in one seamless 360-degree camera orbit while the environment transforms through four coordinated moods without breaking position or eye line.'],
  ['toxic-glitch', 'TOXIC GLITCH', 'VFX', '16 / 9', '16:9', 'a bold portrait with strong contrast', 'Flood the frame with electric green chemical textures, controlled digital tearing and liquid refractions while keeping the face readable and the motion deliberate.'],
  ['marble-statue', 'MARBLE STATUE', 'FASHION', '16 / 9', '16:9', 'a posed fashion portrait with visible clothing', 'Turn the subject gradually into carved marble, move raking gallery light across the stone and restore warm skin and fabric by the final frame.'],
  ['ultraviolet-night', 'ULTRAVIOLET NIGHT', 'VFX', '16 / 9', '16:9', 'a portrait or street scene with dark negative space', 'Reveal ultraviolet paint, fluorescent edges and hidden markings as the light sweeps across the scene, preserving natural depth and skin detail.'],
  ['bubble-world', 'BUBBLE WORLD', 'FANTASY', '16 / 9', '16:9', 'a portrait with open space around the face', 'Fill the environment with translucent floating bubbles that refract miniature copies of the scene, then pass the camera through one bubble into a bright new world.'],
  ['acid-colour', 'ACID COLOUR', 'VFX', '16 / 9', '16:9', 'a high-contrast portrait or action frame', 'Push vivid liquid colour bands through the image with analogue distortion, solarised highlights and controlled motion trails while anatomy stays stable.'],
  ['flash-comic', 'FLASH COMIC', 'CARTOONS', '16 / 9', '16:9', 'a dynamic character pose or action image', 'Convert the action into bold comic panels with inked outlines, halftone shadows and impact frames, then break the character cleanly out of the final panel.'],
  ['radiant-glow', 'RADIANT GLOW', 'FASHION', '16 / 9', '16:9', 'a close fashion or beauty portrait', 'Move soft bands of coloured light around the subject, building a radiant editorial glow that traces facial features and fabric without flattening natural texture.'],
  ['lava-flow', 'LAVA FLOW', 'VFX', '16 / 9', '16:9', 'a full-body portrait on solid ground', 'Crack the ground into glowing lava channels around the subject, send heat shimmer through the air and keep the person safely grounded at the centre.'],
  ['duotone-motion', 'DUOTONE MOTION', 'ADS', '16 / 9', '16:9', 'a product, portrait or graphic composition', 'Reduce the scene to two bold brand-ready colours, animate clean wipes and offset silhouettes, then resolve into one sharp hero composition.'],
  ['particle-burst', 'PARTICLE BURST', 'VFX', '16 / 9', '16:9', 'a clean portrait with strong separation from the background', 'Dissolve the subject into thousands of luminous particles, carry them through a spiralling camera move and reform the original body and clothing precisely.'],
  ['canvas-paint', 'CANVAS PAINT', 'CARTOONS', '16 / 9', '16:9', 'a portrait or landscape suited to a painted treatment', 'Build the scene from thick wet paint on canvas, reveal dimensional brush ridges under moving light and let the painted subject make one subtle living gesture.'],
  ['motion-tracking', 'MOTION TRACKING', 'ADS', '16 / 9', '16:9', 'a moving subject or product with clear edges', 'Track clean graphic lines, labels and shapes to the moving subject with precise perspective, smooth camera motion and no text or brand marks.'],
  ['prism-dream', 'PRISM DREAM', 'VFX', '3 / 2', '16:9', 'a close portrait with directional light', 'Pass the portrait through layered prism refractions, spectral colour splits and liquid lens distortions while the eyes and face remain sharply recognisable.'],
  ['colour-palette', 'COLOUR PALETTE', 'ADS', '16 / 9', '16:9', 'a product or fashion image with a clear colour story', 'Extract the scene into a moving palette of colour blocks, let each block reveal a coordinated detail and reunite everything in a polished final frame.'],
  ['knights-diary', "KNIGHT'S DIARY", 'FANTASY', '1 / 1', '1:1', 'a character portrait suitable for a medieval scene', 'Open an illustrated diary whose pages come alive as the uploaded character becomes a travelling knight moving through inked castles and candlelit forests.'],
  ['magazine-cover', 'MAGAZINE COVER', 'FASHION', '16 / 9', '16:9', 'a clean editorial portrait with space around the subject', 'Lay out the portrait as a premium moving magazine spread with paper folds, image windows and elegant crop changes, using no readable masthead or captions.'],
  ['overexposed-flash', 'OVEREXPOSED FLASH', 'FASHION', '16 / 9', '16:9', 'a fashion portrait or nightlife image', 'Create a rapid editorial sequence of direct-camera flashes, blown highlights, crisp frozen poses and brief film-burn transitions while identity remains consistent.'],
  ['multiverse-doors', 'MULTIVERSE DOORS', 'FANTASY', '16 / 9', '16:9', 'a full-body portrait near a doorway or open space', 'Open several impossible doorways around the subject, each revealing a different world, then move through them in one continuous spatially coherent camera path.'],
  ['impressionist-muse', 'IMPRESSIONIST MUSE', 'FASHION', '1 / 2', '9:16', 'a close portrait with softly lit features', 'Transform the portrait into a luminous impressionist painting with moving water lilies, dappled colour and visible brushwork while the face stays recognisable.'],
  ['many-eyed-portrait', 'MANY-EYED PORTRAIT', 'VFX', '1 / 2', '9:16', 'a centred close portrait with both eyes visible', 'Add a symmetrical field of surreal blinking eyes across the portrait and background, keeping the original face stable and the effect graphic rather than frightening.'],
  ['cold-vision', 'COLD VISION', 'CINEMATIC', '16 / 9', '16:9', 'a portrait or landscape with strong depth', 'Shift the scene into an icy blue cinematic world as frost grows across surfaces, breath condenses and cool volumetric light moves through the frame.'],
  ['sketch-world', 'SKETCH WORLD', 'CARTOONS', '16 / 9', '16:9', 'a person or object with a clear outline', 'Redraw the scene as animated graphite lines on textured paper, let construction marks move around the subject and shade the final frame by hand.'],
  ['lost-in-a-book', 'LOST IN A BOOK', 'FANTASY', '1 / 2', '9:16', 'a character portrait reading or holding a book', 'Pull the uploaded character into an open storybook as illustrated landscapes rise from the pages and the camera follows them between miniature paper worlds.'],
  ['retro-paparazzi', 'RETRO PAPARAZZI', 'FASHION', '1 / 1', '1:1', 'a confident full-body fashion portrait', 'Stage a turn-of-the-century celebrity arrival with handheld press cameras, frequent flashbulbs and energetic crowd movement while the subject walks calmly through frame.'],
  ['noir-city', 'NOIR CITY', 'MOVIES', '16 / 9', '16:9', 'a portrait or street scene suited to dramatic shadows', 'Turn the scene into a rain-soaked monochrome noir sequence with hard window light, drifting smoke and a slow detective-style camera push.'],
  ['ocean-room', 'OCEAN ROOM', 'FANTASY', '16 / 9', '16:9', 'a full-body interior portrait with visible floor and walls', 'Let clear ocean water and schools of fish flow through the room without flooding the subject, using calm caustic light and dreamlike depth.'],
  ['chromatic-surge', 'CHROMATIC SURGE', 'VFX', '16 / 9', '16:9', 'a dynamic portrait or performance image', 'Send dense ribbons of saturated colour around the moving subject, blending ink, light and motion trails into a controlled rhythmic surge.'],
  ['penguin-flight', 'PENGUIN FLIGHT', 'FANTASY', '9 / 16', '9:16', 'a full-body outdoor portrait with a clear silhouette', 'Place the subject on the back of a giant friendly penguin gliding over frozen peaks, with believable balance, wind, feathers and sweeping aerial perspective.'],
];

const films = [
  ['character-takeover', 'CHARACTER TAKEOVER', 'YOUR PHOTO', '9 / 16', '9:16', 'a full-body character reference with a clear face and outfit', 'Transfer the movement of a staged performer into the uploaded character, preserving the new identity from head to toe through energetic choreography and camera motion.'],
  ['escalator-loop', 'ESCALATOR LOOP', 'FASHION', '9 / 16', '9:16', 'a full-body fashion portrait', 'Create a seamless top-down fashion loop on a descending escalator as repeated versions of the same subject enter, pose and disappear with precise spacing.'],
  ['blood-moon-dance', 'BLOOD MOON DANCE', 'ANIME', '16 / 9', '16:9', 'a character design or portrait for the lead performer', 'Stage a gothic formation dance on a ruined cathedral rooftop beneath a huge red moon, with distinct choreography, wind-driven costumes and dramatic anime lighting.'],
  ['red-thread-story', 'RED THREAD STORY', 'CARTOONS', '16 / 9', '16:9', 'one or two character references with clearly visible faces', 'Tell an emotional urban story through connected scenes as a glowing red thread travels between the characters, matching compositions and movement across every cut.'],
  ['meal-together', 'MEAL TOGETHER', 'CARTOONS', '16 / 9', '16:9', 'two character references for a warm shared scene', 'Follow two characters preparing and sharing a meal through a compact sequence of coordinated kitchen actions, expressive close-ups and a warm final table reveal.'],
  ['tentacle-breakout', 'TENTACLE BREAKOUT', 'MOVIES', '9 / 16', '9:16', 'a portrait suitable for a staged cinema audience scene', 'Film a playful handheld cinema moment where a harmless fantasy tentacle appears to emerge from the screen, startles the audience and curls past the uploaded character.'],
  ['sheep-kingdom', 'SHEEP KINGDOM', 'FANTASY', '16 / 9', '16:9', 'a full-body fantasy character portrait', 'Follow the uploaded character across a green highland among sheep, then reveal a vast pale-stone kingdom through one rising cinematic camera move.'],
  ['pumpkin-night', 'PUMPKIN NIGHT', 'FANTASY', '9 / 16', '9:16', 'a full-body portrait suitable for a night-time scene', 'Transfer a lively dance performance into a glowing pumpkin patch, preserving the subject while lantern creatures and autumn leaves respond to the choreography.'],
  ['fashion-catch', 'FASHION CATCH', 'ADS', '16 / 9', '16:9', 'a model portrait and a separate clean garment or accessory image', 'Create a five-shot fashion commercial where the uploaded garment moves through the air, reaches the model and becomes the centrepiece of a polished final look.'],
  ['desert-train-heist', 'DESERT TRAIN HEIST', 'MOVIES', '16 / 9', '16:9', 'a clear lead-character portrait for a cinematic action scene', 'Stage a fast but bloodless desert train adventure with the uploaded lead moving between carriage roofs, dust, horses and a tense doorway reveal.'],
];

function template([id, name, category, previewAspect, aspect, needs, action], model = 'Kling 3.0 · I2V') {
  const credits = model === 'Seedance 2.0 Fast' ? 28 : 32;
  const bg = category === 'FANTASY' ? 'linear-gradient(155deg,#071525 0%,#31556e 55%,#cf9e63 100%)'
    : category === 'CARTOONS' ? 'linear-gradient(155deg,#201029 0%,#7a356f 55%,#f0b85f 100%)'
      : category === 'FASHION' ? 'linear-gradient(155deg,#171319 0%,#624d68 55%,#d6ad96 100%)'
        : 'linear-gradient(155deg,#091118 0%,#334b5d 55%,#c47b55 100%)';
  return {
    ...base, id, clipKey: id, name, category, previewAspect, aspect, needs, model, credits, bg, steps,
    prompt: `Animate the uploaded starting image into a polished ten-second ${name.toLowerCase()} sequence. Preserve the subject's exact identity, body, clothing, colours and proportions throughout. ${action} Use physically coherent movement, stable anatomy, deliberate camera work and high-detail cinematic lighting. Add no captions, logos or watermark.`,
  };
}

export const SOURCE_TEMPLATE_EXPANSION_4 = [
  ...looks.map((entry) => template(entry)),
  ...films.map((entry) => template(entry, 'Seedance 2.0 Fast')),
];

export const SHOWCASE_CLIP_EXPANSION_4 = Object.fromEntries(SOURCE_TEMPLATE_EXPANSION_4.map((entry) => [entry.clipKey, {
  video: `/showcase/viral-${entry.id}.mp4`,
  aspectRatio: entry.previewAspect,
  poster: `/showcase/viral-${entry.id}.jpg`,
  title: entry.name.toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase()),
}]));
