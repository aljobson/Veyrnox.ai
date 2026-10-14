const base = {
  model: 'Kling 3.0 · I2V',
  credits: 34,
  durationSeconds: 10,
  isNew: true,
  inspired: true,
  promptOrigin: 'veyrnox-adaptation',
  negativePrompt: 'identity drift, warped anatomy, duplicate subjects, flicker, jump cuts, captions, logos, watermark',
};

const steps = [
  'Upload a clear starting image that matches the subject guidance.',
  'Use this template to load its ten-second prompt and settings.',
  'Review the framing and identity details before generating.',
];

function template({ id, clipKey = id, name, category, aspect, needs, prompt, bg }) {
  return { ...base, id, clipKey, name, category, previewAspect: aspect, needs, prompt, bg, steps };
}

export const SOURCE_TEMPLATE_EXPANSION_2 = [
  template({
    id: 'enchanted-forest-selfie', name: 'ENCHANTED FOREST SELFIE', category: 'FANTASY', aspect: '720 / 406',
    needs: 'A clear character portrait with visible hair and clothing',
    bg: 'linear-gradient(145deg,#071510 0%,#345447 55%,#a78c74 100%)',
    prompt: 'Animate the uploaded character through a tense twilight forest chase. Preserve their exact face, hair and clothing as they run between mossy trees while shadowy enchanted creatures close in. Use urgent handheld tracking, expressive close-ups and realistic wind and foot contact. In the final beat, release the tension: the creatures crowd beside the character for one unexpected smiling group selfie. Keep the transformation playful and cinematic, with no duplicate face, captions, logos or watermark.',
  }),
  template({
    id: 'pumpkin-lings', name: 'PUMPKIN LINGS', category: 'FANTASY', aspect: '406 / 720',
    needs: 'A full-body character photo with a clear silhouette',
    bg: 'linear-gradient(165deg,#120b08 0%,#7a3c18 55%,#f3a63e 100%)',
    prompt: 'Animate the uploaded character walking into a moonlit pumpkin patch. Preserve their face, body, clothing and footwear as small lively pumpkin creatures emerge from the vines and follow in a curious procession. Let lantern light ripple across the scene, leaves react to each step and the character kneel to greet the smallest creature. Use coherent scale, natural contact shadows and smooth vertical camera movement, with no captions, logos or watermark.',
  }),
  template({
    id: 'dont-blow-out-the-pumpkin', name: "DON'T BLOW OUT THE PUMPKIN", category: 'VFX', aspect: '406 / 720',
    needs: 'A chest-up portrait holding or framed beside a small pumpkin',
    bg: 'linear-gradient(165deg,#050303 0%,#4a1c0d 58%,#f47b21 100%)',
    prompt: 'Create a fixed vertical close-up from the uploaded portrait against black. Preserve the person’s recognizable face, hair and clothing as they gently blow out a small glowing jack-o-lantern. After a brief blackout, transfer the same orange light into their eyes and smile, adding subtle pumpkin texture while keeping the face readable. Hold the eerie glowing look, then end with a sudden fast push toward camera and an abrupt cut to black. Keep it bloodless, with no captions, logos or watermark.',
  }),
  template({
    id: 'rap-takeover', name: 'RAP TAKEOVER', category: 'UGC', aspect: '406 / 720',
    needs: 'A full-body performer photo with clear clothing and face',
    bg: 'linear-gradient(160deg,#100509 0%,#7d1027 55%,#f05941 100%)',
    prompt: 'Animate the uploaded performer commanding a crowded red-lit music venue. Preserve their exact identity, outfit and proportions as they move through the audience, gesture to the beat and deliver an energetic rap performance into a handheld camera. Keep foreground phones and people crossing naturally, retain accurate occlusion and contact, and use raw continuous handheld movement with realistic motion blur. Do not add captions, logos or watermark.',
  }),
  template({
    id: 'urban-broomstick-flight', name: 'URBAN BROOMSTICK FLIGHT', category: 'FANTASY', aspect: '406 / 720',
    needs: 'A full-body character photo with the legs clearly visible',
    bg: 'linear-gradient(160deg,#0a1318 0%,#294a5b 55%,#d67933 100%)',
    prompt: 'Animate the uploaded character riding a broomstick through a modern city corridor at speed. Preserve their face, hair, clothing and body proportions while they bank between concrete walls, pass beneath lights and rise toward open sky. Keep both hands and legs anchored naturally to the broom, with believable wind, fabric motion, shadows and perspective. Use an energetic following camera and one continuous flight path with no captions, logos or watermark.',
  }),
  template({
    id: 'hotel-window-watch', name: 'HOTEL WINDOW WATCH', category: 'MOVIES', aspect: '406 / 720',
    needs: 'A full-body character photo staged in a bright room near a window',
    bg: 'linear-gradient(160deg,#23313a 0%,#7394a6 55%,#e7c9a2 100%)',
    prompt: 'Create a staged cinematic shot from across a hotel courtyard. Through a panoramic window, animate the uploaded character playfully dancing in front of a mirror inside a bright room. Preserve their exact identity, outfit and room geometry as the handheld camera zooms closer through realistic reflections. The character notices the lens, smiles, walks to the window and pulls the curtain shut. Keep the performance clearly staged, physically natural and free of captions, logos or watermark.',
  }),
  template({
    id: 'broomstick-flight', name: 'BROOMSTICK FLIGHT', category: 'FANTASY', aspect: '406 / 720',
    needs: 'A clear full-body character photo with an unobstructed pose',
    bg: 'linear-gradient(160deg,#182027 0%,#536b76 55%,#c7aa7a 100%)',
    prompt: 'Animate the uploaded character flying low on a broomstick beside a moving vehicle and across open countryside. Preserve their exact face, hairstyle, clothing and proportions while the body leans into acceleration and wind pulls naturally at fabric and hair. Keep hands gripping the broom, feet clear of the road and scale consistent as the camera tracks through the window. Use believable speed, reflections and motion blur with no captions, logos or watermark.',
  }),
  template({
    id: 'money-flex', name: 'MONEY FLEX', category: 'UGC', aspect: '406 / 720',
    needs: 'A starting image containing two clearly separated performers at a table',
    bg: 'linear-gradient(160deg,#17100a 0%,#664b31 55%,#d7bc8d 100%)',
    prompt: 'Animate both people in the uploaded starting image into a playful vertical money-counting performance at a table. Preserve each face, hairstyle, body and outfit without swapping identities as they fan notes, gesture toward camera and react to one another in synchronized rhythm. Keep the casual phone-camera angle, believable hand-to-note contact, table reflections and warm indoor light. Avoid duplicate hands, floating objects, readable brands, captions, logos and watermark.',
  }),
  template({
    id: 'epic-slap-knockout', name: 'EPIC SLAP KNOCKOUT', category: 'MOVIES', aspect: '406 / 720',
    needs: 'A starting image containing two adult performers in a staged competition',
    bg: 'linear-gradient(160deg,#151515 0%,#65615a 55%,#d5bd84 100%)',
    prompt: 'Create a clearly staged vertical slap-contest scene from the uploaded two-person image. Preserve both adult identities and outfits as one performer delivers a single choreographed open-hand slap, the other reacts with delayed theatrical momentum and a referee steps in. Use safe padded staging, realistic balance and body weight, a fixed audience camera and no visible injury, blood or repeated impact. Keep hands and faces coherent with no captions, logos or watermark.',
  }),
  template({
    id: 'agamemnon', clipKey: 'wall-agamemnon', name: 'AGAMEMNON', category: 'MOVIES', aspect: '600 / 338',
    needs: 'A seated cinema portrait with the screen visible behind the subject',
    bg: 'linear-gradient(150deg,#100806 0%,#593122 55%,#d4874d 100%)',
    prompt: 'Animate the uploaded cinema scene into a surreal theatrical reveal. Preserve the seated viewer’s identity and clothing as an ancient armoured warrior steps out of the glowing screen behind them and rows of matching soldiers begin moving through the auditorium. Use warm projector light, realistic armour reflections, deep theatre shadows and a smooth camera push that keeps the viewer foregrounded. Maintain coherent scale and exclude captions, logos and watermark.',
  }),
  template({
    id: 'blue-depth', clipKey: 'wall-blue-depth', name: 'BLUE DEPTH', category: 'FASHION', aspect: '600 / 338',
    needs: 'A full-body fashion portrait with a clean silhouette',
    bg: 'linear-gradient(150deg,#03131f 0%,#075783 55%,#51b6cf 100%)',
    prompt: 'Transform the uploaded fashion portrait into an elegant underwater editorial. Preserve the subject’s face, hair, body and outfit as translucent fish drift at different depths and fabric moves slowly in the current. Use deep cobalt water, soft caustic light, subtle suspended particles and a steady lateral camera glide. Keep natural anatomy, calm expression and believable depth separation, with no added text, logos or watermark.',
  }),
  template({
    id: 'cyclope', clipKey: 'wall-cyclope', name: 'CYCLOPE', category: 'FANTASY', aspect: '600 / 338',
    needs: 'A full-body outdoor portrait with open landscape behind the subject',
    bg: 'linear-gradient(150deg,#182019 0%,#4c6751 55%,#a8b28c 100%)',
    prompt: 'Animate the uploaded outdoor subject as a colossal stone cyclops rises from the landscape behind them. Preserve the person’s exact identity, pose and clothing while the giant’s hand grips the earth and its single eye focuses forward. Add shifting grass, falling soil, distant haze and convincing contact shadows as the camera pulls back to reveal scale. Keep the effect cinematic and grounded with no captions, logos or watermark.',
  }),
  template({
    id: 'fairytale-castle', clipKey: 'wall-fairytale-castle', name: 'FAIRYTALE CASTLE', category: 'FANTASY', aspect: '600 / 338',
    needs: 'A full-body outdoor character photo with space in the background',
    bg: 'linear-gradient(150deg,#17252d 0%,#526d73 55%,#d89f71 100%)',
    prompt: 'Animate the uploaded character running across a windswept meadow at cool dusk. Preserve their face, hair, clothing and direction of travel as the handheld camera follows, then lifts once to reveal an enormous distant fairytale castle and fireworks above its towers. Maintain continuous geography, realistic grass and hair movement, natural atmospheric depth and one unbroken camera move. Add no captions, logos or watermark.',
  }),
  template({
    id: 'infinite-clones', clipKey: 'wall-infinite-clones', name: 'INFINITE CLONES', category: 'VFX', aspect: '600 / 600',
    needs: 'A clear character photo with enough surrounding space for repeats',
    bg: 'linear-gradient(150deg,#13171a 0%,#4b5962 55%,#cf8d69 100%)',
    prompt: 'Animate the uploaded subject into a recursive clone reveal. Preserve one exact identity and outfit as successive copies emerge from the same moving scene at diminishing scales, each repeating the original gesture with precise timing. Let the camera travel smoothly through the nested layers while perspective, shadows and occlusion remain physically consistent. Keep every copy recognizably identical, with no hybrid faces, captions, logos or watermark.',
  }),
  template({
    id: 'moonwalk', clipKey: 'wall-moonwalk', name: 'MOONWALK', category: 'FANTASY', aspect: '600 / 338',
    needs: 'A full-body performance photo with a strong silhouette',
    bg: 'linear-gradient(150deg,#07182a 0%,#336994 55%,#f0d08a 100%)',
    prompt: 'Animate the uploaded performer on a theatrical stage beneath blue curtains and a glowing star. Preserve their exact identity, outfit and proportions as they climb onto a suspended crescent moon and balance gracefully while it swings above a small sculpted world. Use practical stage lighting, believable rig motion, soft haze and a slow audience-facing camera move. Keep hands, feet and moon contact coherent with no captions, logos or watermark.',
  }),
  template({
    id: 'skatedog', clipKey: 'wall-skatedog', name: 'SKATEDOG', category: 'UGC', aspect: '600 / 338',
    needs: 'A clear low-angle photo of a dog or character beside a skateboard',
    bg: 'linear-gradient(150deg,#22262a 0%,#6c7474 55%,#d5a64d 100%)',
    prompt: 'Animate the uploaded dog or character riding a skateboard through an urban plaza. Preserve the exact coat, face, clothing and scale while paws or feet stay planted on the deck and the body shifts naturally through turns. Use a playful fisheye lens close to the wheels, realistic board flex, rolling shadows and smooth ground contact. Avoid extra limbs, floating wheels, collisions, captions, logos or watermark.',
  }),
  template({
    id: 'windows', clipKey: 'wall-windows', name: 'WINDOWS', category: 'VFX', aspect: '600 / 338',
    needs: 'A close portrait with a clean face and strong expression',
    bg: 'linear-gradient(150deg,#0b1431 0%,#284f9b 55%,#d8d8f4 100%)',
    prompt: 'Turn the uploaded portrait into a fast digital collage of floating desktop windows. Preserve the subject’s recognizable face, hair and expression as repeated camera panels, cursor trails and layered interface frames slide across a blue screen-space environment. Use crisp parallax, controlled glitch cuts and synchronized zooms while keeping the portrait stable in every panel. Use generic interface shapes only, with no product names, platform marks, captions, logos or watermark.',
  }),
];
