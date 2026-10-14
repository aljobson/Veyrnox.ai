import { SYNTX_EXPANSION_SOURCES } from './syntxExpansionSource.js';

const bySlug = Object.fromEntries(SYNTX_EXPANSION_SOURCES.map((source) => [source.slug, source]));

const base = {
  model: 'Kling 3.0 · I2V',
  credits: 34,
  durationSeconds: 5,
  isNew: true,
  promptOrigin: 'veyrnox-adaptation',
  negativePrompt: 'identity drift, warped anatomy, duplicate subjects, flicker, jump cuts, captions, logos, watermark',
};

const steps = [
  'Upload a clear starting image that matches the subject guidance.',
  'Use this template to load its five-second prompt and settings.',
  'Review the framing and identity details before generating.',
];

function syntxTemplate({ slug, clipKey = slug, category, aspect, needs, prompt, bg }) {
  const source = bySlug[slug];
  return {
    ...base,
    id: slug,
    name: source.title.toUpperCase(),
    clipKey,
    category,
    previewAspect: aspect,
    bg,
    needs,
    prompt,
    steps,
    sourceRecipe: {
      name: 'SYNTX',
      url: `https://syntx.ai/trends/${slug}`,
      prompt: source.prompt,
      promptSha256: source.promptSha256,
      promptOrigin: 'published',
      model: source.model,
      settings: { ...source.settings, output_format: 'mp4' },
      durationSeconds: source.durationSeconds,
      inputs: [{ slot: 'image1', kind: 'image', role: 'Primary subject identity and clothing.', providedBySource: false, required: true }],
      references: [],
      exampleVideoUrl: source.sourceVideoUrl,
    },
  };
}

function higgsfieldTemplate({ slug, clipKey = slug, name, category, aspect, needs, prompt, description, bg }) {
  return {
    ...base,
    id: slug,
    name,
    clipKey,
    category,
    previewAspect: aspect,
    bg,
    needs,
    prompt,
    steps,
    sourceRecipe: {
      name: 'Higgsfield',
      url: `https://higgsfield.ai/effects/use/${slug}`,
      description,
      prompt: null,
      promptOrigin: 'not-public',
      model: null,
      settings: { resolution: '720p', aspect_ratio: aspect },
      durationSeconds: 7,
      inputs: [{ slot: 'Image', kind: 'image', role: 'Primary subject and scene.', providedBySource: false, required: true }],
      references: [],
    },
  };
}

export const SOURCE_TEMPLATE_EXPANSION = [
  syntxTemplate({
    slug: 'jellyfish-airlines', category: 'FANTASY', aspect: '720 / 406',
    needs: 'A clear full-body character photo with visible clothing',
    bg: 'linear-gradient(150deg,#102844 0%,#735276 55%,#f0a45e 100%)',
    prompt: 'Animate the uploaded character riding a vast bioluminescent jellyfish through a realistic sunset sky. Preserve their exact face, hair, clothing and proportions as they lean into a fast banking turn, gripping taut reins pulled by two airborne fish. Make the jellyfish bell pulse for propulsion, stream its tentacles in the wind, and reveal coral towers and distant glowing giants below. Use grounded cinematic light, continuous physical motion, natural wind response and no text or watermark.',
  }),
  syntxTemplate({
    slug: 'dandelion-ball', category: 'FANTASY', aspect: '720 / 406',
    needs: 'A clear full-body character photo',
    bg: 'linear-gradient(145deg,#1a2818 0%,#64704a 55%,#e4cf93 100%)',
    prompt: 'Animate the uploaded character entering an elegant twilight ballroom built among enormous dandelions. Preserve their exact identity and outfit while luminous seeds float through the air and guests turn toward them. Track forward at walking pace, then arc gently as the character reaches the dance floor. Keep the scene photorealistic, the fabric and drifting seeds physically natural, and the lighting warm, cinematic and consistent with no captions or watermark.',
  }),
  syntxTemplate({
    slug: 'sm-brand-new-day', category: 'CINEMATIC', aspect: '720 / 406',
    needs: 'A clear portrait or full-body performer photo',
    bg: 'linear-gradient(145deg,#1f3443 0%,#6e765a 58%,#f0bd6e 100%)',
    prompt: 'Create a bright cinematic music-video moment starring the uploaded performer at the start of a brand-new day. Preserve their face, hairstyle, body and clothing while they move confidently through sunlit streets, with energetic camera tracking, soft lens flare and believable crowd motion. Use a continuous visual rhythm, natural lip and body movement, crisp daylight colour and stable identity throughout. Do not add titles, logos or watermarks.',
  }),
  syntxTemplate({
    slug: 'who-was-that-business', category: 'UGC', aspect: '720 / 540',
    needs: 'A clear character photo suitable for a polished office scene',
    bg: 'linear-gradient(150deg,#171b22 0%,#465263 55%,#bdc6d2 100%)',
    prompt: 'Animate the uploaded character in a polished business-comedy scene. Preserve their exact identity, hairstyle, proportions and wardrobe as they stride through a modern office, exchange a surprised look with a colleague and turn back as if asking who just passed. Use restrained handheld camera movement, natural reactions, accurate eye lines and believable office lighting. Keep faces consistent and exclude captions, logos and watermarks.',
  }),
  higgsfieldTemplate({
    slug: 'scrapbook-collage', name: 'SCRAPBOOK COLLAGE', category: 'FASHION', aspect: '406 / 720',
    needs: 'A clean full-body fashion photo',
    bg: 'linear-gradient(170deg,#f0e8dc 0%,#87b9b4 55%,#dd6b72 100%)',
    description: 'A central full-body shot appears alongside smaller inset close-ups in a dynamic scrapbook layout for fashion videos, lookbooks and stylized edits.',
    prompt: 'Turn the uploaded fashion portrait into a moving scrapbook collage. Keep one full-body cutout centered while torn-paper panels reveal synchronized close-ups of the face, shoes and outfit details. Add hand-drawn marks, paper texture and subtle parallax as the layout assembles, while preserving the subject’s exact identity and clothing. Keep every panel crisp and coordinated, with no extra people, captions, logos or watermark.',
  }),
  higgsfieldTemplate({
    slug: 'stop-world', name: 'STOP WORLD', category: 'VFX', aspect: '540 / 720',
    needs: 'A street portrait with a clearly separated central subject',
    bg: 'linear-gradient(165deg,#4b555a 0%,#b39883 55%,#e28188 100%)',
    description: 'The public preview holds the central subject steady while the surrounding street crowd streaks past in accelerated motion.',
    prompt: 'Animate the uploaded street portrait so the central subject walks calmly toward camera while the world around them accelerates. Keep their face, bright outfit and pace perfectly stable as pedestrians sweep past in directional motion blur on both sides. Use a locked forward composition, realistic contact shadows and continuous crowd flow to make the subject feel isolated in time. Avoid duplicate faces, collisions, captions, logos and watermark.',
  }),
  higgsfieldTemplate({
    slug: 'earth-zoom', name: 'EARTH ZOOM', category: 'CINEMATIC', aspect: '406 / 720',
    needs: 'A clear outdoor portrait with visible surroundings',
    bg: 'linear-gradient(170deg,#091925 0%,#496476 55%,#bdc8ce 100%)',
    description: 'A rapid continuous pull-back carries the view from a grounded scene into an aerial city view and toward the scale of Earth.',
    prompt: 'Begin on the uploaded outdoor subject and execute one seamless accelerating pull-back. Preserve the starting person and location as the camera rises above the street, then the district, city and coastline until the landscape reads at planetary scale. Maintain geographic continuity, realistic atmosphere and smooth scale changes with no abrupt cuts. Keep the opening identity accurate and add no labels, captions, logos or watermark.',
  }),
  higgsfieldTemplate({
    slug: 'comic', name: 'COMIC', category: 'CARTOONS', aspect: '720 / 398',
    needs: 'A dynamic portrait or action pose',
    bg: 'linear-gradient(145deg,#07161b 0%,#117378 55%,#f28d42 100%)',
    description: 'A graphic illustrated comic treatment with bold ink contours, flattened colour and action-panel energy.',
    prompt: 'Transform the uploaded subject into a graphic animated comic scene while preserving their recognizable face, pose and clothing. Apply bold ink contours, flat teal-and-orange colour blocks, halftone shadows and sharp speed accents as the camera pushes through a dramatic action beat. Keep anatomy and line work coherent from frame to frame, like a living printed panel, with no speech bubbles, captions, logos or watermark.',
  }),
  syntxTemplate({
    slug: 'trick-or-skin', clipKey: 'wall-trick-or-skin', category: 'VFX', aspect: '720 / 404',
    needs: 'A well-lit close portrait with the face unobstructed',
    bg: 'linear-gradient(150deg,#140c18 0%,#623342 55%,#e68b55 100%)',
    prompt: 'Animate the uploaded close portrait into a controlled practical-horror transformation. Preserve the person’s exact eyes, hair and facial structure as a thin theatrical skin-like layer peels away to reveal a second stylized look beneath, then settles into the final expression. Use convincing material tension, subtle breathing and stable camera framing. Keep the effect cinematic rather than graphic, with no identity drift, captions, logos or watermark.',
  }),
  syntxTemplate({
    slug: 'the-wrong-one', clipKey: 'wall-the-wrong-one', category: 'MOVIES', aspect: '720 / 406',
    needs: 'A clear cinematic character portrait',
    bg: 'linear-gradient(150deg,#17171d 0%,#55443f 55%,#b18a6c 100%)',
    prompt: 'Create a tense cinematic reveal around the uploaded character. Preserve their exact identity and wardrobe as they realize they have approached the wrong person, pause, exchange a loaded glance and slowly step back. Use precise eye lines, restrained performance, shallow depth of field and a smooth camera creep that heightens the misunderstanding. Maintain continuity and realistic lighting with no text, logos or watermark.',
  }),
  higgsfieldTemplate({
    slug: 'pigeons', clipKey: 'wall-pigeons', name: 'PIGEONS', category: 'UGC', aspect: '720 / 720',
    needs: 'A full-body street photo with room around the subject',
    bg: 'linear-gradient(150deg,#2b3133 0%,#89836e 55%,#dbbc77 100%)',
    description: 'A fisheye street action effect where the subject launches upward amid fast, chaotic city motion and birds.',
    prompt: 'Animate the uploaded street subject into a playful fisheye action shot. Preserve their face and outfit as they spring upward and a flock of pigeons bursts from the pavement around them. Let the birds cross foreground and background at different depths while the wide lens exaggerates the jump and city perspective. Keep the landing physics, shadows and camera motion believable, with no duplicate subject, captions, logos or watermark.',
  }),
  higgsfieldTemplate({
    slug: 'mighty-fighter', clipKey: 'wall-mighty-fighter', name: 'MIGHTY FIGHTER', category: 'FANTASY', aspect: '406 / 720',
    needs: 'A full-body character photo with a strong silhouette',
    bg: 'linear-gradient(170deg,#0e1519 0%,#45535b 55%,#9b2730 100%)',
    description: 'A cinematic fantasy-warrior transformation staged in a windswept field with armour, cloak and heroic weapon motion.',
    prompt: 'Transform the uploaded full-body character into a cinematic fantasy fighter standing in a windswept field. Preserve their face and body proportions while forming detailed armour, a long cloak and a grounded weapon pose around them. Add moving grass, drifting dust and restrained fabric motion as the camera rises into a heroic low angle. Keep hands, weapon contact and armour geometry coherent, with no captions, logos or watermark.',
  }),
];
