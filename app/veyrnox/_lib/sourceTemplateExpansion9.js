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

const categoryMeta = {
  CARTOONS: { needsKey: 'community.cartoons', sourceGuidance: 'A clear full-body animal or original character image', background: 'linear-gradient(155deg,#21162d,#73537f,#e5b57a)' },
  CINEMATIC: { needsKey: 'community.cinematic', sourceGuidance: 'A clear full-body portrait with room for cinematic movement', background: 'linear-gradient(155deg,#111923,#44596a,#d3a76e)' },
  FASHION: { needsKey: 'community.fashion', sourceGuidance: 'A clear full-body fashion portrait with clothing unobstructed', background: 'linear-gradient(155deg,#23172b,#76506f,#e0aa9a)' },
  MOVIES: { needsKey: 'community.movies', sourceGuidance: 'A clear portrait of the original character or cast', background: 'linear-gradient(155deg,#151a22,#5e4b4d,#c99a72)' },
  PRODUCTS: { needsKey: 'community.products', sourceGuidance: 'A clear image of the subject and featured vehicle or product', background: 'linear-gradient(155deg,#12212a,#456978,#d2b273)' },
  UGC: { needsKey: 'community.ugc', sourceGuidance: 'A clear portrait with face, hands and clothing visible', background: 'linear-gradient(155deg,#171c27,#4d5871,#d19c83)' },
  VFX: { needsKey: 'community.vfx', sourceGuidance: 'A clear subject image with open space around the effect area', background: 'linear-gradient(155deg,#17182d,#4e4d85,#d68e92)' },
};
const groupMeta = { needsKey: 'community.group', sourceGuidance: 'One starting image containing every subject in their intended positions' };
const groupIds = new Set([
  'community-balcony-club-encounter',
  'community-corporate-duo-jam',
  'community-monster-street-dance',
]);
const generatedEnsembleIds = new Set([
  'community-ensemble-performance-recast',
  'community-street-dance-ensemble',
  'community-suit-choir-groove',
]);

// Concepts drive compatible I2V generation prompts; exact source prompts are separate read-only provenance.
const recipes = [
  ['community-urban-trio-performance', 'URBAN TRIO PERFORMANCE', 'UGC', '16:9', '600 / 338', 'three friends trade close-ups, group choreography and playful gestures across a night plaza'],
  ['community-overhead-performance', 'OVERHEAD PERFORMANCE', 'UGC', '16:9', '600 / 338', 'a top-down camera follows expressive head turns and broad arm movements'],
  ['community-roadside-celebration', 'ROADSIDE CELEBRATION', 'UGC', '9:16', '480 / 854', 'friends dance beside original parked vehicles under a warm sunset sky'],
  ['community-night-vehicle-portrait', 'NIGHT VEHICLE PORTRAIT', 'PRODUCTS', '16:9', '600 / 338', 'a person and their vehicle move from low-detail shots into a polished evening hero frame'],
  ['community-ballroom-entrance', 'BALLROOM ENTRANCE', 'FASHION', '9:16', '600 / 1066', 'a formally dressed subject enters a lively ballroom and finishes with an elegant dance-floor pose'],
  ['community-overhead-expression', 'OVERHEAD EXPRESSION', 'UGC', '16:9', '600 / 338', 'an overhead portrait comes alive through changing expressions and sweeping arm gestures'],
  ['community-street-dance-ensemble', 'STREET DANCE ENSEMBLE', 'UGC', '16:9', '600 / 450', 'a lead performer guides an original streetwear crew through clean formation changes'],
  ['community-highway-drift-showcase', 'HIGHWAY DRIFT SHOWCASE', 'PRODUCTS', '16:9', '600 / 338', 'the uploaded vehicle travels through open roads, tunnels and one controlled drift'],
  ['community-luxe-pajama-dance', 'LUXE PAJAMA DANCE', 'FASHION', '9:16', '600 / 800', 'the subject performs a playful dance in an original marble bathroom wearing bright silk sleepwear'],
  ['community-suit-exchange-dance', 'SUIT EXCHANGE DANCE', 'FASHION', '9:16', '600 / 1066', 'two formally dressed subjects exchange playful gestures and synchronized steps'],
  ['community-pitch-footwork', 'PITCH FOOTWORK', 'CINEMATIC', '9:16', '600 / 1066', 'a player uses close control to move between defenders and complete a composed finish'],
  ['community-survivor-memory-shift', 'SURVIVOR MEMORY SHIFT', 'MOVIES', '16:9', '600 / 338', 'a tense rain-dark confrontation match-cuts into a warm field memory'],
  ['community-dancing-dog', 'DANCING DOG', 'CARTOONS', '9:16', '480 / 854', 'the uploaded dog stands upright for a playful, balanced kitchen dance'],
  ['community-cinematic-blast-walk', 'CINEMATIC BLAST WALK', 'VFX', '9:16', '600 / 1066', 'the subject walks calmly toward camera as a controlled film-set fireball blooms far behind'],
  ['community-jester-pitch-run', 'JESTER PITCH RUN', 'CARTOONS', '9:16', '480 / 854', 'an original whimsical character dribbles past defenders and celebrates a goal'],
  ['community-cathedral-entrance-walk', 'CATHEDRAL ENTRANCE WALK', 'CINEMATIC', '1:1', '600 / 656', 'the subject walks through a grand original stone hall and pauses in soft window light'],
  ['community-suit-choir-groove', 'SUIT CHOIR GROOVE', 'UGC', '16:9', '600 / 338', 'a formally dressed lead expands into a synchronized ensemble with a wide final pose'],
  ['community-driver-portrait', 'DRIVER PORTRAIT', 'CINEMATIC', '16:9', '600 / 338', 'a seated driver follows a cinematic route with natural steering and changing exterior light'],
  ['community-club-dj-set', 'CLUB DJ SET', 'UGC', '9:16', '480 / 854', 'the subject mixes on an original nightclub console and engages a lively crowd'],
  ['community-biker-dog-adventure', 'BIKER DOG ADVENTURE', 'CARTOONS', '9:16', '600 / 1066', 'the uploaded dog becomes a playful fictional rider in a controlled road adventure'],
  ['community-foggy-street-dance', 'FOGGY STREET DANCE', 'MOVIES', '9:16', '600 / 1066', 'an original synchronized routine unfolds on a foggy city street at night'],
  ['community-noir-leading-role', 'NOIR LEADING ROLE', 'MOVIES', '1:1', '600 / 600', 'a black-and-white montage follows the lead through training, preparation and intense close portraits'],
  ['community-kitchen-snack-heist', 'KITCHEN SNACK HEIST', 'UGC', '9:16', '600 / 800', 'the subject checks the room, opens the refrigerator and steals one spoonful of dessert'],
  ['community-candle-wish-drift', 'CANDLE WISH DRIFT', 'CINEMATIC', '9:16', '600 / 1066', 'a safe parked-car birthday wish ends on a dramatic monochrome freeze'],
  ['community-action-hero-strut', 'ACTION HERO STRUT', 'VFX', '9:16', '600 / 1066', 'the subject makes a composed walk as a distant controlled explosion expands behind'],
  ['community-supercar-card-reveal', 'SUPERCAR CARD REVEAL', 'PRODUCTS', '16:9', '600 / 338', 'a flourish of neutral playing cards wipes into an original sports-car reveal'],
  ['community-convertible-joyride', 'CONVERTIBLE JOYRIDE', 'CINEMATIC', '16:9', '600 / 450', 'two subjects share a cheerful performance during an original open-top road trip'],
  ['community-corporate-duo-jam', 'CORPORATE DUO JAM', 'UGC', '1:1', '600 / 600', 'one professional plays a compact keyboard while the other answers with celebratory gestures'],
  ['community-elevator-duo-routine', 'ELEVATOR DUO ROUTINE', 'UGC', '9:16', '600 / 1072', 'two performers alternate compact footwork and finish in sync inside a reflective elevator'],
  ['community-midnight-wolf-greeting', 'MIDNIGHT WOLF GREETING', 'CINEMATIC', '9:16', '600 / 1066', 'the subject kneels beside a parked car and calmly greets a wolf from a safe distance'],
  ['community-luxury-car-exit', 'LUXURY CAR EXIT', 'FASHION', '9:16', '480 / 854', 'the subject exits a convertible, adds an outer layer and walks away confidently'],
  ['community-monster-street-dance', 'MONSTER STREET DANCE', 'CARTOONS', '9:16', '600 / 1066', 'friendly original cinematic creatures perform coordinated street choreography'],
  ['community-feline-runway-duo', 'FELINE RUNWAY DUO', 'CARTOONS', '9:16', '600 / 1066', 'two cats stand upright for a playful studio runway walk and synchronized pose'],
  ['community-portrait-performance-recast', 'PORTRAIT PERFORMANCE RECAST', 'UGC', '1:1', '600 / 600', 'a compact character performance moves through gestures and ends on a confident close-up'],
  ['community-rug-outfit-morph', 'RUG OUTFIT MORPH', 'FASHION', '9:16', '600 / 1072', 'fabric wipes cycle the reclined subject through several original streetwear looks'],
  ['community-meadow-duo-dance', 'MEADOW DUO DANCE', 'CINEMATIC', '9:16', '480 / 854', 'two subjects perform a romantic meadow duet with a gentle turn and safe supported lift'],
  ['community-urban-character-portrait', 'URBAN CHARACTER PORTRAIT', 'FASHION', '9:16', '600 / 1066', 'the subject walks through a busy original street and settles into a hero pose'],
  ['community-night-pop-trio', 'NIGHT POP TRIO', 'UGC', '16:9', '600 / 338', 'three performers trade solo frames, group choreography and a handheld selfie ending'],
  ['community-rotating-wardrobe-wipe', 'ROTATING WARDROBE WIPE', 'FASHION', '9:16', '600 / 1066', 'a rotating foreground fan masks clean transitions between original fashion looks'],
  ['community-ensemble-performance-recast', 'ENSEMBLE PERFORMANCE RECAST', 'CINEMATIC', '16:9', '600 / 450', 'an original character moves from a wide ensemble introduction into expressive medium shots'],
  ['community-golden-gown-walk', 'GOLDEN GOWN WALK', 'FASHION', '9:16', '600 / 1066', 'the subject walks through the city in an original gold-toned gown and turns toward camera'],
  ['community-convertible-style-drive', 'CONVERTIBLE STYLE DRIVE', 'FASHION', '9:16', '600 / 1066', 'the subject takes an original convertible through a polished, wind-swept style drive'],
  ['community-octagon-victory', 'OCTAGON VICTORY', 'CINEMATIC', '9:16', '600 / 1066', 'an athlete performs controlled pad strikes and a respectful victory pose in an original arena'],
  ['community-supercar-getaway', 'SUPERCAR GETAWAY', 'PRODUCTS', '9:16', '600 / 1066', 'the subject approaches an original sports car, enters it and makes a composed departure'],
  ['community-truck-stop-celebration', 'TRUCK STOP CELEBRATION', 'UGC', '9:16', '600 / 1066', 'friends trade rhythmic gestures beside a parked original truck at sunset'],
  ['community-kitchen-duo', 'KITCHEN DUO', 'UGC', '9:16', '600 / 1066', 'two subjects prepare a playful snack with mirrored movements and a shared reaction'],
  ['community-savannah-encounter', 'SAVANNAH ENCOUNTER', 'CINEMATIC', '9:16', '600 / 1066', 'the subject observes lions passing peacefully at a clearly safe distance'],
  ['community-court-character-run', 'COURT CHARACTER RUN', 'CINEMATIC', '9:16', '600 / 1066', 'an athlete completes a crossover, drive and balanced finish in an original arena'],
  ['community-wide-supercar-card-reveal', 'WIDE SUPERCAR CARD REVEAL', 'PRODUCTS', '16:9', '600 / 356', 'a wide card flourish clears to reveal an original sports car'],
  ['community-vintage-style-montage', 'VINTAGE STYLE MONTAGE', 'FASHION', '9:16', '600 / 1066', 'the subject appears across several original vintage-inspired film and fashion setups'],
  ['community-canine-recording-session', 'CANINE RECORDING SESSION', 'CARTOONS', '9:16', '600 / 1066', 'two stylized poodles mirror playful musical gestures in an original recording studio'],
  ['community-streetwear-intersection', 'STREETWEAR INTERSECTION', 'FASHION', '9:16', '600 / 1066', 'the camera orbits a stationary subject while an original city intersection flows behind'],
  ['community-stone-arcade-pose', 'STONE ARCADE POSE', 'FASHION', '9:16', '600 / 1066', 'the subject performs measured fashion gestures beneath an original stone arcade'],
  ['community-star-power-trio', 'STAR POWER TRIO', 'FASHION', '16:9', '600 / 338', 'three formally dressed subjects perform alternating gestures and a synchronized final beat'],
  ['community-balcony-club-encounter', 'BALCONY CLUB ENCOUNTER', 'MOVIES', '9:16', '600 / 1066', 'a balcony observer and dance-floor performer connect through matching gestures'],
  ['community-masked-card-reveal', 'MASKED CARD REVEAL', 'VFX', '9:16', '600 / 1304', 'an original masked character uses a card flourish to reveal an original sports car'],
  ['community-street-dance-trio', 'STREET DANCE TRIO', 'UGC', '9:16', '600 / 1066', 'three performers execute synchronized hand patterns, footwork and a clean formation change'],
  ['community-stage-dance-routine', 'STAGE DANCE ROUTINE', 'UGC', '9:16', '480 / 854', 'the uploaded performer completes an energetic original stage routine and confident finish'],
  ['community-layered-suit-transition', 'LAYERED SUIT TRANSITION', 'FASHION', '9:16', '600 / 1066', 'hand and fabric wipes layer original accessories over one consistent oversized suit'],
  ['community-giant-city-stride', 'GIANT CITY STRIDE', 'VFX', '9:16', '600 / 1066', 'the subject appears as a towering city giant taking one careful step between skyscrapers'],
  ['community-dramatic-character-performance', 'DRAMATIC CHARACTER PERFORMANCE', 'MOVIES', '1:1', '600 / 600', 'a cinematic portrait uses restrained gestures, changing eyelines and an intense final close-up'],
  ['community-courtside-crossover', 'COURTSIDE CROSSOVER', 'CINEMATIC', '9:16', '600 / 1066', 'an athlete makes a sharp crossover, accelerates and completes a balanced arena finish'],
  ['community-lounge-group-performance', 'LOUNGE GROUP PERFORMANCE', 'UGC', '16:9', '600 / 338', 'several subjects exchange gestures during an intimate low-light lounge performance'],
  ['community-car-selfie-performance', 'CAR SELFIE PERFORMANCE', 'UGC', '9:16', '600 / 1066', 'a safely parked car selfie comes alive through expressions, head turns and gestures'],
  ['community-night-celebration-drive', 'NIGHT CELEBRATION DRIVE', 'CINEMATIC', '9:16', '600 / 1224', 'the subject sprays sparkling water beside a safely parked vehicle during a night celebration'],
  ['community-feline-dance-duo', 'FELINE DANCE DUO', 'CARTOONS', '9:16', '600 / 1066', 'two upright cats perform a synchronized routine with expressive paw gestures'],
  ['community-feline-dance-solo', 'FELINE DANCE SOLO', 'CARTOONS', '9:16', '480 / 854', 'the uploaded animal stands upright for a short rhythmic solo and final pose'],
  ['community-cast-carpool', 'CAST CARPOOL', 'UGC', '16:9', '600 / 338', 'four subjects remain in fixed seats during an original parked-car singalong'],
  ['community-liquid-truck-assembly', 'LIQUID TRUCK ASSEMBLY', 'VFX', '9:16', '480 / 854', 'glossy black liquid crosses a warehouse floor and assembles into the uploaded semi-truck'],
  ['community-supercar-streetwear-exit', 'SUPERCAR STREETWEAR EXIT', 'FASHION', '9:16', '600 / 1066', 'the subject steps from an original supercar, walks forward and finishes on a streetwear pose'],
  ['community-dual-character-performance', 'DUAL CHARACTER PERFORMANCE', 'UGC', '9:16', '600 / 1066', 'two subjects alternate gestures, mirror one movement and share a final pose'],
  ['community-stage-performance-sync', 'STAGE PERFORMANCE SYNC', 'UGC', '9:16', '600 / 1066', 'the subject performs on an original outdoor stage while a crowd watches from a safe distance'],
  ['community-marble-hallway-pose', 'MARBLE HALLWAY POSE', 'FASHION', '9:16', '600 / 1066', 'the subject turns, moves their hair and settles into an editorial marble-hallway pose'],
  ['community-athletic-pose-sequence', 'ATHLETIC POSE SEQUENCE', 'UGC', '9:16', '600 / 1066', 'the subject completes confident athletic poses followed by one slow full-body rotation'],
  ['community-convertible-cast-drive', 'CONVERTIBLE CAST DRIVE', 'CINEMATIC', '16:9', '600 / 450', 'multiple subjects stay in assigned seats during an original convertible drive'],
  ['community-ballroom-dance-switch', 'BALLROOM DANCE SWITCH', 'FASHION', '9:16', '600 / 1066', 'the subject completes flowing ballroom steps, a controlled turn and a camera-facing finish'],
  ['community-nightclub-rhythm', 'NIGHTCLUB RHYTHM', 'UGC', '16:9', '600 / 400', 'the subject leads a compact rhythmic phrase on an original neon dance floor'],
  ['community-mansion-trio-performance', 'MANSION TRIO PERFORMANCE', 'FASHION', '16:9', '600 / 338', 'three subjects perform in an elegant mansion wearing coordinated original formal looks'],
  ['community-riverside-branch-comedy', 'RIVERSIDE BRANCH COMEDY', 'CINEMATIC', '9:16', '600 / 1066', 'a safe dry-ground visual gag uses a fallen branch, prop tool and surprised reaction'],
  ['community-urban-street-pose', 'URBAN STREET POSE', 'FASHION', '9:16', '600 / 1066', 'the subject lifts sunglasses, walks along a brick-lined sidewalk and finishes on an editorial pose'],
];

export const SOURCE_TEMPLATE_EXPANSION_9 = recipes.map(([id, name, category, sourceAspect, previewAspect, concept]) => {
  const meta = groupIds.has(id) || (!generatedEnsembleIds.has(id) && /\b(?:two|three|four|several|multiple|friends|crew|ensemble|trio|duo|subjects|performers|people|cast|group)\b/i.test(concept)) ? groupMeta : categoryMeta[category];
  const adaptedPrompt = `Animate the uploaded image into a polished ten-second ${name.toLowerCase()} sequence. The example is inspiration; generate an original shot from the uploaded image rather than copying its exact motion. Create an original scene in which ${concept}. Preserve every subject's identity, clothing and proportions with readable hands, stable anatomy, coherent contact and natural light. Use smooth motion and add no captions, logos or watermark.`;
  return {
    ...base, id, name, category, sourceAspect, previewAspect,
    needsKey: meta.needsKey, needs: meta.sourceGuidance,
    bg: categoryMeta[category].background, clipKey: id, steps,
    promptOrigin: 'veyrnox-adaptation',
    prompt: adaptedPrompt,
  };
});

export const SHOWCASE_CLIP_EXPANSION_9 = Object.fromEntries(SOURCE_TEMPLATE_EXPANSION_9.map((entry) => [entry.clipKey, {
  video: `/showcase/creator-${entry.id}.mp4`, poster: `/showcase/creator-${entry.id}.webp`, aspectRatio: entry.previewAspect,
  title: entry.name.toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase()),
}]));
