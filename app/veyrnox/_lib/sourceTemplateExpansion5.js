const base = {
  model: 'Kling 3.0 · I2V',
  credits: 32,
  durationSeconds: 10,
  category: 'KIDS BIRTHDAY',
  aspect: '16:9',
  previewAspect: '16 / 9',
  isNew: true,
  inspired: true,
  promptOrigin: 'veyrnox-adaptation',
  negativePrompt: 'identity drift, warped anatomy, duplicate children, frightening imagery, flicker, jump cuts, captions, logos, watermark',
};

const steps = [
  'Upload a clear birthday portrait or party photo you have permission to use.',
  'Edit the age, colours and party details in the ten-second prompt.',
  'Generate a 5s or 10s shot, or build a 30–120s multi-shot birthday film in Film Studio.',
];

const recipes = [
  {
    id: 'birthday-rocket-launch',
    name: 'BIRTHDAY ROCKET',
    needs: 'A clear full-body birthday portrait with space around the child',
    bg: 'linear-gradient(155deg,#07152b 0%,#2855a8 54%,#ffb347 100%)',
    action: 'Transform the party room into a cheerful mission-control set as a toy rocket grows behind the child, lifts through soft clouds and carries the celebration into a colourful star field. End on a safe, triumphant zero-gravity pose with balloons orbiting like planets.',
  },
  {
    id: 'candle-wish-world',
    name: 'CANDLE WISH WORLD',
    needs: 'A close birthday portrait beside a cake with visible candles',
    bg: 'linear-gradient(155deg,#1d0b21 0%,#8f3d72 55%,#ffd273 100%)',
    action: 'When the child blows out the candles, each flame becomes a warm firefly and opens a miniature wish world above the cake. Glide through floating sweets, tiny clouds and glowing paper stars before returning to the child smiling at the relit room.',
  },
  {
    id: 'giant-age-adventure',
    name: 'GIANT AGE ADVENTURE',
    needs: 'A full-body portrait plus the birthday age written into the editable prompt',
    bg: 'linear-gradient(155deg,#20113d 0%,#7045c7 55%,#ffde59 100%)',
    action: 'Build a playful world around one giant sculpted age numeral. The child climbs colourful steps, slides down a rounded edge and lands in a burst of balloons while the camera reveals the complete number. Keep every movement gentle, joyful and physically believable.',
  },
  {
    id: 'dinosaur-birthday-parade',
    name: 'DINO PARTY PARADE',
    needs: 'A full-body portrait in a simple open setting',
    bg: 'linear-gradient(155deg,#0a281b 0%,#2e7d4d 54%,#f6c85f 100%)',
    action: 'Turn the setting into a sunny prehistoric birthday parade led by friendly original dinosaurs in party hats. Small dinosaurs carry wrapped gifts, a gentle long-neck holds bunting overhead and the child marches at the centre beneath drifting confetti.',
  },
  {
    id: 'underwater-birthday-kingdom',
    name: 'UNDERWATER BIRTHDAY KINGDOM',
    needs: 'A clear portrait with a simple background and visible clothing',
    bg: 'linear-gradient(155deg,#031b32 0%,#087d9c 55%,#63e6be 100%)',
    action: 'Transform the room into a bright underwater birthday kingdom with coral towers, bubble balloons and schools of jewel-coloured fish. Give the child a flowing sea-court cape and guide the camera toward a glowing shell-shaped cake, keeping the scene playful rather than realistic danger.',
  },
  {
    id: 'toybox-comes-alive',
    name: 'TOYBOX PARTY',
    needs: 'A child seated or standing near a favourite unbranded toy',
    bg: 'linear-gradient(155deg,#25103a 0%,#b53f8c 54%,#ffcb4c 100%)',
    action: 'Open a toybox and let original wooden animals, tin robots and building blocks spring into a coordinated birthday dance. The child conducts the tiny parade while toys stack into a colourful cake silhouette and freeze in a celebratory final pose.',
  },
  {
    id: 'monster-disco-party',
    name: 'MONSTER DISCO',
    needs: 'A clear dancing pose or full-body party portrait',
    bg: 'linear-gradient(155deg,#170923 0%,#64268a 52%,#27d3c2 100%)',
    action: 'Turn the party into a neon disco shared with three friendly original fuzzy monsters. Give each monster a distinct colour and simple dance move, synchronise them with the child beneath a mirror ball, and finish with a confetti freeze-frame full of laughter.',
  },
  {
    id: 'mini-cake-chef',
    name: 'MINI CAKE CHEF',
    needs: 'A waist-up portrait at a table or kitchen counter',
    bg: 'linear-gradient(155deg,#332013 0%,#c26a3b 54%,#ffe0a3 100%)',
    action: 'Shrink the child into a miniature pastry chef working on a giant birthday cake. Show one clear sequence: climb a wafer ladder, pipe a ribbon of icing, roll a berry into place and plant a final candle as the camera rises to reveal the finished cake.',
  },
  {
    id: 'birthday-news-report',
    name: 'BIRTHDAY NEWS FLASH',
    needs: 'A centred portrait facing the camera',
    bg: 'linear-gradient(155deg,#07182b 0%,#174f83 54%,#ef4f4f 100%)',
    action: 'Place the child in an original colourful newsroom presenting the happiest breaking story of the day. Move from an anchor-desk close-up to playful live reports from the cake table and gift station, using abstract graphic panels with no readable text or broadcaster branding.',
  },
  {
    id: 'party-invitation-trailer',
    name: 'PARTY INVITATION TRAILER',
    needs: 'A party portrait with room for decorations around the subject',
    bg: 'linear-gradient(155deg,#24112f 0%,#a73c75 54%,#ffcc66 100%)',
    action: 'Create an energetic invitation trailer that reveals the child, cake, balloons and party venue through clean match cuts and ribbon-like transitions. Leave clear negative space for the family to add date and place later in the editor; do not render names, dates or other text in the generated footage.',
  },
  {
    id: 'growing-up-timeline',
    name: 'GROWING UP TIMELINE',
    needs: 'A current portrait to anchor a gentle age-progression story',
    bg: 'linear-gradient(155deg,#15203a 0%,#4c75a8 54%,#f5c37a 100%)',
    action: 'Guide the child through an original storybook timeline made of framed memory moments, from first steps to today. Use warm seasonal transitions and consistent facial features, then gather the frames into one gallery around the present-day birthday portrait without inventing real private events.',
  },
  {
    id: 'birthday-highlight-reel',
    name: 'BIRTHDAY HIGHLIGHT REEL',
    needs: 'A lively party photo with the main child clearly visible',
    bg: 'linear-gradient(155deg,#23121f 0%,#9f466c 54%,#ffd86b 100%)',
    action: 'Turn one party image into a polished highlight reel: arrival, decorations, games, candle wish, gift reveal and a joyful group finale. Connect each moment with motivated camera moves and matching colour so it can serve as the opening shot plan for a longer Film Studio memory film.',
  },
];

export const SOURCE_TEMPLATE_EXPANSION_5 = recipes.map(({ action, ...recipe }) => ({
  ...base,
  ...recipe,
  clipKey: recipe.id,
  steps,
  prompt: `Animate the uploaded starting image into a polished ten-second ${recipe.name.toLowerCase()} sequence. Preserve the main child's exact face, age cues, body, clothing colours and proportions throughout. ${action} Use smooth camera movement, stable anatomy, natural contact shadows and bright cinematic detail. Add no captions, logos, franchise characters or watermark.`,
}));

export const SHOWCASE_CLIP_EXPANSION_5 = Object.fromEntries(SOURCE_TEMPLATE_EXPANSION_5.map((entry) => [entry.clipKey, {
  video: `/showcase/viral-${entry.id}.mp4`,
  aspectRatio: entry.previewAspect,
  poster: `/showcase/viral-${entry.id}.jpg`,
  title: entry.name.toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase()),
}]));
