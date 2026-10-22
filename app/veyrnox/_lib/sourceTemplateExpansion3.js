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

function template({ id, clipKey = id, name, category, aspect, generationAspect, needs, prompt, bg, model = 'Kling 3.0 · I2V' }) {
  return { ...base, id, clipKey, name, category, previewAspect: aspect, aspect: generationAspect, needs, prompt, bg, model, credits: model === 'Seedance 2.0 Fast' ? 28 : 32, steps };
}

export const SOURCE_TEMPLATE_EXPANSION_3 = [
  template({
    id: 'city-trailer', name: 'CITY TRAILER', category: 'CINEMATIC', aspect: '720 / 1280', generationAspect: '9:16', model: 'Seedance 2.0 Fast',
    needs: 'A city starting frame with a clear subject or landmark',
    bg: 'linear-gradient(165deg,#08111f 0%,#425c72 55%,#df9c57 100%)',
    prompt: 'Turn the uploaded city frame into a fast ten-second vertical trailer. Move through tactile street details, traffic lights, wet pavement, transit and a bright downtown reveal using rhythmic match cuts that preserve direction and geography. Keep the main subject or landmark recognizable, use crisp natural motion blur and a polished cinematic grade, and finish on a clean hero frame with no titles, logos or watermark.',
  }),
  template({
    id: 'city-vlog', name: 'CITY VLOG', category: 'UGC', aspect: '720 / 1280', generationAspect: '9:16',
    needs: 'A clear full-body city portrait',
    bg: 'linear-gradient(165deg,#15191d 0%,#57626c 55%,#e0b07a 100%)',
    prompt: 'Animate the uploaded person through a candid ten-second city vlog. Preserve their exact face, hair, clothing and proportions while a handheld camera follows them along the pavement, catches a natural interaction and swings into a lively street reveal. Use believable walking contact, foreground occlusion, restrained phone-camera shake and consistent daylight. Add no captions, logos or watermark.',
  }),
  template({
    id: 'floral-pool-portrait', name: 'FLORAL POOL PORTRAIT', category: 'FASHION', aspect: '720 / 1280', generationAspect: '9:16',
    needs: 'A waist-up portrait with the face and clothing clearly visible',
    bg: 'linear-gradient(165deg,#172338 0%,#427f89 55%,#ef9eaa 100%)',
    prompt: 'Transform the uploaded portrait into a dreamlike ten-second floral pool editorial. Preserve the subject’s exact identity, hair and clothing as they stand waist-deep in clear water surrounded by dense floating flowers. Make one slow orbit while petals drift, fabric responds to the water and reflected light moves naturally across the face. Keep the atmosphere luxurious and photorealistic with no added text, logos or watermark.',
  }),
  template({
    id: 'paper-fragments', name: 'PAPER FRAGMENTS', category: 'VFX', aspect: '1200 / 662', generationAspect: '16:9',
    needs: 'A clean portrait with strong separation from the background',
    bg: 'linear-gradient(150deg,#ece7df 0%,#ca6557 55%,#24252a 100%)',
    prompt: 'Animate the uploaded subject breaking into layered torn-paper fragments and graphic printed textures. Preserve their face and outfit as the pieces burst outward at different depths, rotate with believable weight and then reform into the original portrait in one continuous ten-second move. Use crisp edges, subtle shadows and deliberate red, cream and black accents. Keep anatomy coherent and add no captions, logos or watermark.',
  }),
  template({
    id: 'ink-sprint', name: 'INK SPRINT', category: 'CARTOONS', aspect: '1280 / 720', generationAspect: '16:9',
    needs: 'A dynamic running or full-body action image',
    bg: 'linear-gradient(150deg,#f2eee7 0%,#c9202c 55%,#0b0b0d 100%)',
    prompt: 'Turn the uploaded runner into a kinetic ten-second red-and-black ink illustration. Preserve the subject’s recognizable face, silhouette and clothing as live brush strokes overtake the scene, speed lines stretch behind them and the camera tracks alongside. Alternate clean photographic detail with bold hand-painted frames while motion remains continuous and anatomy stable. Use no captions, logos or watermark.',
  }),
  template({
    id: 'motorcycle-double', name: 'MOTORCYCLE DOUBLE', category: 'REALISTIC', aspect: '3 / 4', generationAspect: '9:16',
    needs: 'A full-body portrait beside a motorcycle',
    bg: 'linear-gradient(165deg,#101318 0%,#545c66 55%,#ca8958 100%)',
    prompt: 'Animate the uploaded person beside their motorcycle as a matching double emerges from a reflection and steps into the real scene. Preserve the same exact identity, outfit and proportions on both figures while keeping their positions distinct and their eye lines intentional. Use a slow handheld push, realistic metal reflections, grounded feet and coherent shadows across ten seconds. Add no captions, logos or watermark.',
  }),
  template({
    id: 'laundromat-monster', name: 'LAUNDROMAT MONSTER', category: 'MOVIES', aspect: '1280 / 720', generationAspect: '16:9', model: 'Seedance 2.0 Fast',
    needs: 'A character portrait suitable for a cinematic interior',
    bg: 'linear-gradient(150deg,#101b1d 0%,#4b6760 55%,#d9b76e 100%)',
    prompt: 'Create a ten-second cinematic laundromat scene starring the uploaded character. Preserve their identity and wardrobe as a washing machine begins to shake, a playful practical-creature silhouette pushes through the open door and the character reacts before taking one confident step forward. Use moody fluorescent light, restrained camera movement, believable machine vibration and clear spatial continuity. Keep it adventurous rather than graphic, with no captions, logos or watermark.',
  }),
  template({
    id: 'curtain-reveal', name: 'CURTAIN REVEAL', category: 'MOVIES', aspect: '4 / 3', generationAspect: '16:9', model: 'Seedance 2.0 Fast',
    needs: 'A clear character portrait framed near curtains or a doorway',
    bg: 'linear-gradient(150deg,#170608 0%,#741b24 55%,#d8a35e 100%)',
    prompt: 'Animate the uploaded character pulling apart rich red theatre curtains in one ten-second cinematic reveal. Preserve their exact face, hair and clothing as warm stage light spills forward and an impossible moonlit landscape appears beyond the opening. Let fabric weight, hands and shadows remain physically coherent while the camera glides through the curtains and ends on the revealed world. Add no titles, logos or watermark.',
  }),
  template({
    id: 'behind-the-lens', clipKey: 'wall-behind-the-lens', name: 'BEHIND THE LENS', category: 'UGC', aspect: '720 / 1280', generationAspect: '9:16',
    needs: 'A creator portrait with a camera or production setting',
    bg: 'linear-gradient(165deg,#151515 0%,#4c4945 55%,#d29b69 100%)',
    prompt: 'Create a ten-second behind-the-scenes creator montage from the uploaded portrait. Preserve the creator’s identity and clothing through close views of the camera, production monitor, sketchbook and a natural collaboration beat. Use documentary handheld movement, tactile focus pulls, matched warm light and continuous visual direction so every cut feels part of the same shoot. Add no captions, logos or watermark.',
  }),
  template({
    id: 'sticker-peel-reveal', clipKey: 'wall-sticker-peel-reveal', name: 'STICKER PEEL REVEAL', category: 'VFX', aspect: '720 / 1280', generationAspect: '9:16',
    needs: 'A full-body portrait against a simple background',
    bg: 'linear-gradient(165deg,#e7ded0 0%,#a66f5d 55%,#312e31 100%)',
    prompt: 'Animate the uploaded person standing still as a giant realistic hand peels away a full-size paper sticker double from directly in front of them. Preserve the real subject’s exact identity, pose and outfit beneath the curling printed layer. Show convincing paper tension, adhesive release, edge shadows and depth while the camera holds a clear vertical composition. Finish with the real subject fully revealed and no captions, logos or watermark.',
  }),
  template({
    id: 'dolphin-surf-ride', clipKey: 'wall-dolphin-surf-ride', name: 'DOLPHIN SURF RIDE', category: 'FANTASY', aspect: '1 / 1', generationAspect: '1:1',
    needs: 'A full-body action portrait with a clear silhouette',
    bg: 'linear-gradient(150deg,#062b45 0%,#0f81a2 55%,#b8eff1 100%)',
    prompt: 'Animate the uploaded character riding a dolphin along the face of a bright ocean wave for ten seconds. Preserve their face, body and clothing while they balance naturally, grip the dolphin without deformation and react to sea spray. Use an energetic fisheye tracking camera, physically consistent water, sunlight and shadows, then finish as both leap through the foam. Add no captions, logos or watermark.',
  }),
  template({
    id: 'event-character-swap', clipKey: 'wall-event-character-swap', name: 'EVENT CHARACTER SWAP', category: 'YOUR PHOTO', aspect: '720 / 1280', generationAspect: '9:16',
    needs: 'A portrait of the person you want to place at a red-lit live event',
    bg: 'linear-gradient(165deg,#130306 0%,#8a1026 55%,#e35645 100%)',
    prompt: 'Place the uploaded person at the centre of a crowded red-lit live event for a ten-second vertical shot. Preserve their exact face, hair, outfit and proportions as a handheld camera moves through foreground guests, phones and stage light. Keep identity stable through occlusion, maintain natural crowd eye lines and let the subject deliver one confident performance gesture. Add no captions, logos or watermark.',
  }),
];
