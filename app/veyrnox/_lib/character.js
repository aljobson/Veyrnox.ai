// Character builder: grouped traits turned into one portrait prompt.
// Option lists ported from Open-Generative-AI's AiInfluencerStudio.jsx (MIT,
// Copyright (c) Anil Matcha). Two changes: origin options say "... heritage"
// rather than upstream's "Scandinavian Supermodel" / "K-Pop Idol phenotype",
// and the base prompt always asks for an original adult, not a real person
// (Terms: no minors, no deepfakes). Client-side only: it changes the prompt,
// never the model or the price.

export const CHARACTER_TABS = ['Face', 'Body', 'Style'];

export const ODDLING_TONES = [
  ['Dry oracle', 'deadpan, precise, faintly prophetic delivery'],
  ['Tender menace', 'soft-spoken warmth with an unsettling edge'],
  ['Grand ceremony', 'formal, theatrical, ceremonial delivery'],
  ['Chaotic expert', 'fast, obsessive, unexpectedly well-informed delivery'],
  ['Cosmic neighbour', 'friendly, curious, matter-of-fact alien perspective'],
];

export const ODDLING_SHOWS = [
  ['Human object reviews', 'reviews ordinary human objects as if they are rare artifacts'],
  ['Impossible weather', 'reports emotional weather from places that cannot exist'],
  ['Tiny field reports', 'delivers compact field reports about overlooked everyday rituals'],
  ['Five-second verdicts', 'gives sharp five-second verdicts on fashion, food, or design'],
  ['Confessions from elsewhere', 'shares intimate confessions from a fictional other world'],
];

export const ODDLING_ARCHETYPES = [
  {
    id: 'duchess-volume',
    kind: 'human',
    name: 'Duchess Volume',
    hook: 'A fat maximalist reviewing tiny snacks with royal seriousness.',
    accent: 'MORE IS MORE',
    picks: { character_type: 'Human', body_type: 'Fat', hair: 'Sculpted Waves', accessories: 'Tiny Handbag', rendering_style: 'Hyper-Realistic', oddling_name: 'Duchess Volume', oddling_obsession: 'tiny snacks, enormous entrances, and whether a room has enough drama', oddling_voice: 'Grand ceremony', oddling_show: 'Five-second verdicts', oddling_rule: 'large soft body, circular ivory quilted couture, miniature silver handbag, tiny crown, pearl details' },
  },
  {
    id: 'major-minor',
    kind: 'human',
    name: 'Major Minor',
    hook: 'A colossal bodybuilder curating the world’s smallest objects.',
    accent: 'TINY THINGS UNIT',
    picks: { character_type: 'Human', body_type: 'Hyper-Muscular', hair: 'Short Hair', accessories: 'Tiny Teacup', rendering_style: 'Hyper-Realistic', oddling_name: 'Major Minor', oddling_obsession: 'miniature teacups, model furniture, and objects too delicate for his hands', oddling_voice: 'Dry oracle', oddling_show: 'Human object reviews', oddling_rule: 'extreme bodybuilder silhouette, miniature brown office tailoring, round glasses, tiny porcelain teacup' },
  },
  {
    id: 'bughead-brenda',
    kind: 'human',
    name: 'Bughead Brenda',
    hook: 'A human etiquette coach who never removes her enormous beetle mask.',
    accent: 'MASK ON · MANNERS UP',
    picks: { character_type: 'Human', body_type: 'Athletic', hair: 'Bald', accessories: 'Bug Head Mask', rendering_style: 'Hyper-Realistic', oddling_name: 'Bughead Brenda', oddling_obsession: 'awkward greetings, personal space, and surviving dinner parties in a huge helmet', oddling_voice: 'Chaotic expert', oddling_show: 'Tiny field reports', oddling_rule: 'ordinary human body and hands, enormous iridescent jewel-beetle fashion helmet, orange utility jumpsuit, holographic boots' },
  },
  {
    id: 'pam-bouffant',
    kind: 'human',
    name: 'Pam Bouffant',
    hook: 'A weather presenter whose hair is usually the biggest system on screen.',
    accent: 'HAIR PRESSURE',
    picks: { character_type: 'Human', hair: 'Monumental Hair', accessories: 'Tiny Sunglasses', rendering_style: 'Hyper-Realistic', oddling_name: 'Pam Bouffant', oddling_obsession: 'wind direction, hairspray pressure, and forecasts that threaten the silhouette', oddling_voice: 'Tender menace', oddling_show: 'Impossible weather', oddling_rule: 'monumental cloud-shaped platinum hair three times wider than shoulders, tiny sunglasses, powder-blue cloud suit, miniature wind meter' },
  },
  {
    id: 'vera-static',
    kind: 'human',
    name: 'Vera Static',
    hook: 'An analog mystic translating radio interference into life advice.',
    accent: 'DEAD AIR ORACLE',
    picks: { character_type: 'Human', hair: 'Sharp Bob', accessories: 'Geometric Veil', rendering_style: 'Hyper-Realistic', oddling_name: 'Vera Static', oddling_obsession: 'the private omens hiding in dead air, hold music, and crossed wires', oddling_voice: 'Dry oracle', oddling_show: 'Impossible weather', oddling_rule: 'razor-sharp black bob, translucent geometric veil, one vintage radio earpiece, silver graphic eyeliner' },
  },
  {
    id: 'mister-monday',
    kind: 'human',
    name: 'Mister Monday',
    hook: 'An office surrealist treating boring objects with sacred importance.',
    accent: 'BUSINESS UNUSUAL',
    picks: { character_type: 'Human', hair: 'Sculpted Waves', accessories: 'Object Jewellery', rendering_style: 'Hyper-Realistic', oddling_name: 'Mister Monday', oddling_obsession: 'staplers, beige mugs, calendar etiquette, and tiny workplace dramas', oddling_voice: 'Grand ceremony', oddling_show: 'Human object reviews', oddling_rule: 'immaculate pinstripe suit, sculpted dark waves, round glasses, tiny clock-and-stapler jewellery, beige mug' },
  },
  {
    id: 'bloom-service',
    kind: 'human',
    name: 'Bloom Service',
    hook: 'A botanical stylist issuing precise advice to emotionally unruly plants.',
    accent: 'GARDEN HOTLINE',
    picks: { character_type: 'Human', hair: 'Flowers', accessories: 'Chrome Brows', rendering_style: 'Hyper-Realistic', oddling_name: 'Bloom Service', oddling_obsession: 'plants with bad boundaries and the rituals people invent to keep them alive', oddling_voice: 'Chaotic expert', oddling_show: 'Tiny field reports', oddling_rule: 'living flower headpiece, green lacquer brows, cream utility tailoring, tiny pruning-shear brooch' },
  },
  {
    id: 'coupon-saint',
    kind: 'human',
    name: 'Coupon Saint',
    hook: 'A supermarket philosopher finding cosmic meaning in tiny savings.',
    accent: 'AISLE VISION',
    picks: { character_type: 'Human', hair: 'Short Hair', accessories: 'Receipt Ribbons', rendering_style: 'Hyper-Realistic', oddling_name: 'Coupon Saint', oddling_obsession: 'discount rituals, loyalty points, and purchases that become personality tests', oddling_voice: 'Tender menace', oddling_show: 'Five-second verdicts', oddling_rule: 'receipt-ribbon couture, metallic grocery-label crown, pearl makeup, restrained gold tailoring' },
  },
  {
    id: 'olive-orbit',
    kind: 'human',
    name: 'Olive Orbit',
    hook: 'A seven-foot etiquette oracle deciding whether rooms deserve an entrance.',
    accent: 'DOORWAY REVIEW',
    picks: { character_type: 'Human', gender: 'Female', ethnicity_origin_base: 'African', age: '60s', skin_tone: 'Deep', body_type: 'Very Skinny', height: 'Very Tall', proportions: 'Long Neck', hair: 'Sphere Cut', hair_color: 'Silver', wardrobe_style: 'Office Surrealist', accessories: 'Impossible Handbag', distinctive_features: 'Pocket Weather Station', rendering_style: 'Hyper-Realistic', oddling_name: 'Olive Orbit', oddling_obsession: 'doorways, entrances, and rooms that have not earned the right to contain her', oddling_voice: 'Dry oracle', oddling_show: 'Five-second verdicts', oddling_rule: 'seven-foot extremely slim silhouette, perfect silver sphere hair, emerald floor-length tailoring, tiny silver orb handbag' },
  },
  {
    id: 'brick-picnic',
    kind: 'human',
    name: 'Brick Picnic',
    hook: 'A compact lunch critic judging sandwiches by structural integrity.',
    accent: 'LOAD-BEARING LUNCH',
    picks: { character_type: 'Human', gender: 'Male', ethnicity_origin_base: 'Asian', age: '40s', skin_tone: 'Golden', body_type: 'Barrel', height: 'Very Short', proportions: 'No Visible Neck', hair: 'Cube Cut', hair_color: 'Black', wardrobe_style: 'Office Surrealist', accessories: 'Tiny Sunglasses', distinctive_features: 'Miniature Thermos', rendering_style: 'Hyper-Realistic', oddling_name: 'Brick Picnic', oddling_obsession: 'sandwich engineering, tiny thermoses, and lunches that could survive an earthquake', oddling_voice: 'Chaotic expert', oddling_show: 'Human object reviews', oddling_rule: 'very short barrel-shaped body, glossy black cube haircut, brown checkerboard suit, miniature chrome thermos' },
  },
  {
    id: 'madame-scissors',
    kind: 'human',
    name: 'Madame Scissors',
    hook: 'A pear-shaped fashion judge cutting bad silhouettes down to size.',
    accent: 'SHAPE AUTHORITY',
    picks: { character_type: 'Human', gender: 'Female', ethnicity_origin_base: 'Indian', age: '50s', skin_tone: 'Warm Brown', body_type: 'Pear', height: 'Tall', proportions: 'Narrow Shoulders', hair: 'Wedge Cut', hair_color: 'Black', wardrobe_style: 'Soft Sculpture', accessories: 'Object Jewellery', distinctive_features: 'Impossible Handbag', rendering_style: 'Hyper-Realistic', oddling_name: 'Madame Scissors', oddling_obsession: 'silhouette crimes, dramatic hems, and the emotional consequences of a weak shoulder line', oddling_voice: 'Tender menace', oddling_show: 'Five-second verdicts', oddling_rule: 'tall pear-shaped silhouette, enormous black triangular wedge hair, pleated rust architectural coat, sharp gold jewellery' },
  },
  {
    id: 'pocket-atlas',
    kind: 'human',
    name: 'Pocket Atlas',
    hook: 'A compact colossus explaining tiny objects with globe-sized confidence.',
    accent: 'SMALL WORLD STRONGMAN',
    picks: { character_type: 'Human', gender: 'Non-binary', ethnicity_origin_base: 'Mixed', age: '30s', skin_tone: 'Rich Brown', body_type: 'Hyper-Muscular', height: 'Short', proportions: 'Huge Hands', hair: 'Short Hair', hair_color: 'Black', wardrobe_style: 'Ceremonial Sportswear', accessories: 'Object Jewellery', distinctive_features: 'Miniature Chair', rendering_style: 'Hyper-Realistic', oddling_name: 'Pocket Atlas', oddling_obsession: 'pocket globes, tiny furniture, and feats of strength too small for anyone else to notice', oddling_voice: 'Grand ceremony', oddling_show: 'Tiny field reports', oddling_rule: 'short hyper-muscular body, deliberately tiny head, cobalt suit with globe buttons, enormous hands holding a miniature chair' },
  },
  {
    id: 'noodle-duke',
    kind: 'human',
    name: 'Noodle Duke',
    hook: 'A wildly lanky aristocrat solving everyday problems with unnecessary ceremony.',
    accent: 'LONG FORM LIVING',
    picks: { character_type: 'Human', gender: 'Male', ethnicity_origin_base: 'Middle Eastern', age: '30s', skin_tone: 'Olive', body_type: 'Lanky', height: 'Very Tall', proportions: 'Tiny Torso', hair: 'Spiral Tower', hair_color: 'Black', wardrobe_style: 'Tiny Formalwear', accessories: 'Object Jewellery', distinctive_features: 'Sacred Stapler', rendering_style: 'Hyper-Realistic', oddling_name: 'Noodle Duke', oddling_obsession: 'long corridors, tiny jackets, and turning trivial errands into royal processions', oddling_voice: 'Grand ceremony', oddling_show: 'Tiny field reports', oddling_rule: 'impossibly lanky body with extremely long limbs, towering spiral hair, shrunken burgundy formal jacket, floor-length tie' },
  },
  {
    id: 'taffy-tessa',
    kind: 'human',
    name: 'Taffy Tessa',
    hook: 'A soft-sculpture rain correspondent dressed for weather that does not exist.',
    accent: 'BUBBLE WARNING',
    picks: { character_type: 'Human', gender: 'Female', ethnicity_origin_base: 'European', age: '40s', skin_tone: 'Fair', body_type: 'Fat', height: 'Average', proportions: 'Natural', hair: 'Twin Discs', hair_color: 'Brown', wardrobe_style: 'Soft Sculpture', accessories: 'Tiny Handbag', distinctive_features: 'Pocket Weather Station', rendering_style: 'Hyper-Realistic', oddling_name: 'Taffy Tessa', oddling_obsession: 'indoor drizzle, inflatable coats, and forecasts delivered from inside emotional bubbles', oddling_voice: 'Cosmic neighbour', oddling_show: 'Impossible weather', oddling_rule: 'confident fat body, two enormous brown hair discs, glossy orange bubble raincoat, tiny violet handbag' },
  },
  {
    id: 'tuesday-triangle',
    kind: 'human',
    name: 'Tuesday Triangle',
    hook: 'A broad-shouldered coach teaching one-move dances for difficult weekdays.',
    accent: 'SHARP MOVES ONLY',
    picks: { character_type: 'Human', gender: 'Female', ethnicity_origin_base: 'Mixed', age: '30s', skin_tone: 'Warm Brown', body_type: 'Inverted Triangle', height: 'Tall', proportions: 'Wide Shoulders', hair: 'Crescent Cut', hair_color: 'Black', wardrobe_style: 'Ceremonial Sportswear', accessories: 'Chrome Brows', distinctive_features: 'Giant Comb', rendering_style: 'Hyper-Realistic', oddling_name: 'Tuesday Triangle', oddling_obsession: 'one-move dances, shoulder geometry, and defeating the emotional shape of Tuesday', oddling_voice: 'Chaotic expert', oddling_show: 'Five-second verdicts', oddling_rule: 'powerful inverted-triangle body, enormous black crescent hair, black-and-yellow origami suit, geometric chrome eyebrows' },
  },
  {
    id: 'colonel-crumb',
    kind: 'human',
    name: 'Colonel Crumb',
    hook: 'A razor-thin cake marshal reviewing desserts smaller than his sleeves.',
    accent: 'CRUMB COMMAND',
    picks: { character_type: 'Human', gender: 'Male', ethnicity_origin_base: 'European', age: '70+', skin_tone: 'Fair', body_type: 'Very Skinny', height: 'Very Tall', proportions: 'Huge Hands', hair: 'Tabletop', hair_color: 'White', wardrobe_style: 'Tiny Formalwear', accessories: 'Object Jewellery', distinctive_features: 'Miniature Cake', rendering_style: 'Hyper-Realistic', oddling_name: 'Colonel Crumb', oddling_obsession: 'tiny cakes, dramatic cuffs, and desserts that maintain military discipline', oddling_voice: 'Grand ceremony', oddling_show: 'Human object reviews', oddling_rule: 'very tall razor-thin older man, enormous white tabletop hair, tiny plum waistcoat, gigantic cream sleeves, miniature cake' },
  },
  {
    id: 'disco-anvil',
    kind: 'human',
    name: 'Disco Anvil',
    hook: 'An athletic nightlife mechanic hammering broken moods back into shape.',
    accent: 'HEAVY HAIR ENERGY',
    picks: { character_type: 'Human', gender: 'Female', ethnicity_origin_base: 'African', age: '20s', skin_tone: 'Deep', body_type: 'Athletic', height: 'Tall', proportions: 'Wide Shoulders', hair: 'Anvil Cut', hair_color: 'Electric Blue', wardrobe_style: 'Ceremonial Sportswear', accessories: 'Chrome Brows', distinctive_features: 'Tiny Microphone', rendering_style: 'Hyper-Realistic', oddling_name: 'Disco Anvil', oddling_obsession: 'repairing bad parties, heavy beats, and hairstyles with industrial load ratings', oddling_voice: 'Chaotic expert', oddling_show: 'Tiny field reports', oddling_rule: 'tall athletic body, electric-blue hair sculpted like a steel anvil, chrome-and-magenta ceremonial tracksuit, tiny microphone' },
  },
  {
    id: 'cloudette-forecast',
    kind: 'human',
    name: 'Cloudette Forecast',
    hook: 'A petite storm auntie predicting social pressure with enormous hair.',
    accent: 'CLOUDS WITH OPINIONS',
    picks: { character_type: 'Human', gender: 'Female', ethnicity_origin_base: 'Asian', age: '50s', skin_tone: 'Golden', body_type: 'Curvy', height: 'Short', proportions: 'No Visible Neck', hair: 'Monumental Hair', hair_color: 'White', wardrobe_style: 'Weather Couture', accessories: 'Tiny Sunglasses', distinctive_features: 'Pocket Weather Station', rendering_style: 'Hyper-Realistic', oddling_name: 'Cloudette Forecast', oddling_obsession: 'social pressure systems, indoor fog, and storms caused by unspoken family opinions', oddling_voice: 'Tender menace', oddling_show: 'Impossible weather', oddling_rule: 'petite curvy older woman, monumental white cloud hair, powder-blue weather-map suit, tiny oval sunglasses' },
  },
  {
    id: 'ziggy-receipt',
    kind: 'human',
    name: 'Ziggy Receipt',
    hook: 'A lightning-haired auditor exposing the emotional cost of every purchase.',
    accent: 'TOTAL: TOO MUCH',
    picks: { character_type: 'Human', gender: 'Non-binary', ethnicity_origin_base: 'Mixed', age: '20s', skin_tone: 'Olive', body_type: 'Slim', height: 'Tall', proportions: 'Long Torso', hair: 'Zigzag Cut', hair_color: 'Copper', wardrobe_style: 'Office Surrealist', accessories: 'Receipt Ribbons', distinctive_features: 'Receipt Train', rendering_style: 'Hyper-Realistic', oddling_name: 'Ziggy Receipt', oddling_obsession: 'hidden costs, loyalty-card confessions, and purchases that arrive with emotional paperwork', oddling_voice: 'Dry oracle', oddling_show: 'Five-second verdicts', oddling_rule: 'tall slim silhouette, copper lightning-bolt hair, ivory-and-red receipt couture, very long printed paper train' },
  },
  {
    id: 'baron-boucle',
    kind: 'human',
    name: 'Baron Bouclé',
    hook: 'A round luxury detective investigating crimes against texture.',
    accent: 'TACTILE JUSTICE',
    picks: { character_type: 'Human', gender: 'Male', ethnicity_origin_base: 'Indian', age: '60s', skin_tone: 'Warm Brown', body_type: 'Fat', height: 'Short', proportions: 'No Visible Neck', hair: 'Donut Halo', hair_color: 'Burgundy', wardrobe_style: 'Soft Sculpture', accessories: 'Tiny Monocle', distinctive_features: 'Impossible Handbag', rendering_style: 'Hyper-Realistic', oddling_name: 'Baron Bouclé', oddling_obsession: 'luxury texture, suspicious upholstery, and tailoring that fails the fingertip test', oddling_voice: 'Dry oracle', oddling_show: 'Human object reviews', oddling_rule: 'short fat older man, giant burgundy donut-halo hair, tiny monocle, velvet jacket and enormous burgundy balloon trousers' },
  },
  {
    id: 'tall-order',
    kind: 'human',
    name: 'Tall Order',
    hook: 'A long-limbed basics critic testing whether ordinary clothes can keep up.',
    accent: 'EXTRA LONG EDITION',
    picks: { character_type: 'Human', gender: 'Female', ethnicity_origin_base: 'Asian', age: '20s', skin_tone: 'Golden', body_type: 'Very Skinny', height: 'Tall', proportions: 'Natural', hair: 'Tube Tower', hair_color: 'Copper', wardrobe_style: 'Modern Basics', rendering_style: 'Hyper-Realistic', oddling_name: 'Tall Order', oddling_obsession: 'plain white T-shirts, impossible inseams, and door frames that interrupt the outfit', oddling_voice: 'Dry oracle', oddling_show: 'Five-second verdicts', oddling_rule: 'tall very skinny adult with natural human proportions, copper tube hair, fitted white T-shirt, indigo skinny jeans, white sneakers' },
  },
  {
    id: 'bubble-barry',
    kind: 'human',
    name: 'Bubble Barry',
    hook: 'A cheerful denim philosopher proving that basic never means small.',
    accent: 'BIG HAIR · BASIC FIT',
    picks: { character_type: 'Human', gender: 'Male', ethnicity_origin_base: 'African', age: '30s', skin_tone: 'Deep', body_type: 'Fat', height: 'Short', proportions: 'No Visible Neck', hair: 'Sphere Cut', hair_color: 'Pink', wardrobe_style: 'Modern Basics', rendering_style: 'Hyper-Realistic', oddling_name: 'Bubble Barry', oddling_obsession: 'perfect T-shirt weight, black denim, and whether a basic outfit can still enter a room first', oddling_voice: 'Cosmic neighbour', oddling_show: 'Human object reviews', oddling_rule: 'short fat man with a large soft round body, enormous bubblegum-pink spherical afro, fitted mustard T-shirt, black tight jeans, ankle boots' },
  },
  {
    id: 'max-rep',
    kind: 'human',
    name: 'Max Rep',
    hook: 'A hyper-muscular fit checker reviewing sleeves under extreme conditions.',
    accent: 'THE STRETCH TEST',
    picks: { character_type: 'Human', gender: 'Female', ethnicity_origin_base: 'Mixed', age: '30s', skin_tone: 'Warm Brown', body_type: 'Hyper-Muscular', height: 'Tall', proportions: 'Wide Shoulders', hair: 'Sculptural Wave Tower', hair_color: 'Black', wardrobe_style: 'Modern Basics', rendering_style: 'Hyper-Realistic', oddling_name: 'Max Rep', oddling_obsession: 'sleeve tension, stretch denim, and clothes that remain calm around unreasonable muscles', oddling_voice: 'Chaotic expert', oddling_show: 'Five-second verdicts', oddling_rule: 'hyper-muscular woman, towering black S-wave hair sculpture, blue fitted T-shirt, acid-green tight jeans, white trainers' },
  },
  {
    id: 'shelf-life',
    kind: 'human',
    name: 'Shelf Life',
    hook: 'A compact street-style archivist with a haircut wider than the trend cycle.',
    accent: 'BASICS ON DISPLAY',
    picks: { character_type: 'Human', gender: 'Non-binary', ethnicity_origin_base: 'Indian', age: '30s', skin_tone: 'Warm Brown', body_type: 'Pear', height: 'Very Short', proportions: 'Narrow Shoulders', hair: 'Shelf Cut', hair_color: 'Black', wardrobe_style: 'Modern Basics', rendering_style: 'Hyper-Realistic', oddling_name: 'Shelf Life', oddling_obsession: 'perfectly plain tees, red sneakers, and storing unpopular opinions in a very wide haircut', oddling_voice: 'Tender menace', oddling_show: 'Tiny field reports', oddling_rule: 'very short pear-shaped body with wide hips and sturdy legs, enormous flat black shelf hair, fitted lilac T-shirt, dark tight jeans, red sneakers' },
  },
  {
    id: 'auntie-antenna',
    kind: 'creature',
    name: 'Auntie Antenna',
    hook: 'A velvet moth oracle forecasting moods instead of weather.',
    accent: 'LILAC SIGNAL',
    picks: { character_type: 'Moth', face_skin_material: 'Fur', hair: 'Antennae', eye_color: 'Amber', rendering_style: 'Hyper-Realistic', oddling_name: 'Auntie Antenna', oddling_obsession: 'the emotional weather hiding inside ordinary days', oddling_voice: 'Dry oracle', oddling_show: 'Impossible weather', oddling_rule: 'velvet plum coat, copper antennae, amber compound eyes' },
  },
  {
    id: 'brine-minister',
    kind: 'creature',
    name: 'Brine Minister',
    hook: 'An octopus diplomat reviewing painfully mundane public spaces.',
    accent: 'TIDAL OFFICE',
    picks: { character_type: 'Octopus', face_skin_material: 'Amphibian', face_surface_pattern: 'Gradient', rendering_style: 'Hyper-Realistic', oddling_name: 'Brine Minister', oddling_obsession: 'public seating, service stations, and minor diplomatic incidents', oddling_voice: 'Grand ceremony', oddling_show: 'Human object reviews', oddling_rule: 'translucent sea-glass skin, eight elegant limbs, navy ceremonial sash' },
  },
  {
    id: 'mossbyte',
    kind: 'creature',
    name: 'Mossbyte',
    hook: 'A botanical machine issuing unreliable plant-care bulletins.',
    accent: 'GARDEN ERROR',
    picks: { character_type: 'Alien', eyes_type: 'Mechanical', face_skin_material: 'Metallic', hair: 'Flowers', face_surface_pattern: 'Veins', rendering_style: 'Hyper-Realistic', oddling_name: 'Mossbyte', oddling_obsession: 'plants, obsolete screens, and forecasts that almost make sense', oddling_voice: 'Chaotic expert', oddling_show: 'Tiny field reports', oddling_rule: 'brushed chrome face, living flowers for antennae, acid-green light seams' },
  },
  {
    id: 'receipt-wraith',
    kind: 'creature',
    name: 'Receipt Wraith',
    hook: 'A spectral accountant auditing absurd little luxuries.',
    accent: 'VOID LEDGER',
    picks: { character_type: 'Spectre', eye_color: 'Solid Black', face_skin_material: 'Porcelain', face_surface_pattern: 'Cracked', rendering_style: 'Hyper-Realistic', oddling_name: 'Receipt Wraith', oddling_obsession: 'tiny purchases with catastrophic emotional overhead', oddling_voice: 'Tender menace', oddling_show: 'Five-second verdicts', oddling_rule: 'cracked white porcelain face, ink-black eyes, thermal-paper veil' },
  },
];

// { id, tab, label, options: [label, prompt phrase][] }
export const CHARACTER_GROUPS = [
  { id: 'character_type', tab: 'Face', label: 'Character Type', options: [
      ['Human', 'human features'],
      ['Elf', 'elf with pointed ears'],
      ['Alien', 'alien creature'],
      ['Moth', 'velvet moth humanoid with expressive antennae'],
      ['Spectre', 'elegant spectral humanoid with an uncanny silhouette'],
      ['Fungus', 'fashionable fungal humanoid with sculptural growths'],
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
  { id: 'age', tab: 'Face', label: 'Adult Age', options: [
      ['20s', 'adult in their twenties'],
      ['30s', 'adult in their thirties'],
      ['40s', 'adult in their forties'],
      ['50s', 'adult in their fifties'],
      ['60s', 'adult in their sixties'],
      ['70+', 'older adult over seventy'],
  ] },
  { id: 'skin_tone', tab: 'Face', label: 'Skin Tone', options: [
      ['Deep', 'deep dark skin tone'],
      ['Rich Brown', 'rich brown skin tone'],
      ['Warm Brown', 'warm brown skin tone'],
      ['Olive', 'olive skin tone'],
      ['Golden', 'golden skin tone'],
      ['Fair', 'fair skin tone'],
      ['Porcelain', 'very pale porcelain skin tone'],
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
  { id: 'eye_shape', tab: 'Face', label: 'Eye Shape', options: [
      ['Round', 'large round eye shape'],
      ['Narrow', 'narrow elongated eye shape'],
      ['Downturned', 'soft downturned eye shape'],
      ['Upturned', 'dramatic upturned eye shape'],
      ['Wide Set', 'unusually wide-set eyes'],
      ['Close Set', 'close-set eyes'],
      ['Graphic Liner', 'strong geometric eyeliner changing the eye silhouette'],
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
  { id: 'head_shape', tab: 'Face', label: 'Head Shape', options: [
      ['Long Oval', 'exaggerated long oval head shape'],
      ['Perfect Round', 'strikingly round head shape'],
      ['Square', 'strong square head shape'],
      ['Heart', 'pronounced heart-shaped face'],
      ['Diamond', 'angular diamond-shaped face'],
      ['Tiny Head', 'deliberately tiny head relative to the body'],
      ['Oversized Head', 'deliberately oversized head relative to the body'],
  ] },
  { id: 'face_features', tab: 'Face', label: 'Face Details', options: [
      ['Tiny Brows', 'extremely tiny precise eyebrows'],
      ['One Brow', 'one continuous sculpted eyebrow'],
      ['Huge Lashes', 'architectural oversized eyelashes'],
      ['Glossy Cheeks', 'high-gloss lacquered cheek makeup'],
      ['Painted Blush', 'bold circular painted blush'],
      ['Metallic Freckles', 'metallic gold freckles'],
      ['Beauty Mark Constellation', 'constellation of graphic beauty marks'],
  ] },
  { id: 'facial_hair', tab: 'Face', label: 'Facial Hair', options: [
      ['Clean Shaven', 'clean-shaven face'],
      ['Pencil Moustache', 'razor-thin pencil moustache'],
      ['Giant Moustache', 'enormous sculptural moustache'],
      ['Forked Beard', 'perfectly styled forked beard'],
      ['Beard Cube', 'beard trimmed into a precise cube'],
      ['Single Chin Curl', 'one long curled strand beneath the chin'],
  ] },
  { id: 'face_skin_material', tab: 'Body', label: 'Face Skin Material', options: [
      ['Human Skin', 'smooth human skin'],
      ['Scales', 'shimmering scales'],
      ['Fur', 'soft fur covered face'],
      ['Amphibian', 'smooth moist amphibian skin'],
      ['Fish Skin', 'iridescent fish scale skin'],
      ['Metallic', 'polished metallic skin'],
      ['Porcelain', 'glazed porcelain skin'],
      ['Glass', 'translucent glass-like skin'],
  ] },
  { id: 'face_surface_pattern', tab: 'Body', label: 'Skin Pattern', options: [
      ['Solid', 'solid color skin'],
      ['Stripes', 'exotic striped skin pattern'],
      ['Spots', 'dappled spotted skin'],
      ['Chess', 'checkerboard skin pattern'],
      ['Veins', 'translucent skin with neon veins'],
      ['Gradient', 'gradient skin coloring'],
      ['Cracked', 'fine cracked glaze pattern'],
      ['Giraffe', 'giraffe print skin markings'],
  ] },
  { id: 'body_type', tab: 'Body', label: 'Body Shape & Size', options: [
      ['Slim', 'slim slender physique'],
      ['Lean', 'lean toned physique'],
      ['Very Skinny', 'very skinny adult physique with an extremely narrow silhouette and long slender limbs'],
      ['Lanky', 'very tall lanky adult with exaggerated long arms and legs'],
      ['Compact', 'very short compact adult silhouette'],
      ['Athletic', 'fit athletic body'],
      ['Muscular', 'strong muscular build'],
      ['Hyper-Muscular', 'exaggerated hyper-muscular bodybuilder physique'],
      ['Curvy', 'curvy body type'],
      ['Pear', 'strong pear-shaped silhouette with narrow shoulders and wide hips'],
      ['Inverted Triangle', 'graphic inverted-triangle silhouette with very broad shoulders and a narrow waist'],
      ['Barrel', 'rounded barrel-shaped torso and sturdy limbs'],
      ['Long Torso', 'exaggeratedly long torso with proportionally short legs'],
      ['Long Legs', 'exaggeratedly long legs with a compact torso'],
      ['Heavy', 'heavy set build'],
      ['Fat', 'fat adult with a large soft body, portrayed confidently and respectfully'],
      ['Skinny', 'very skinny thin build'],
  ] },
  { id: 'height', tab: 'Body', label: 'Height', options: [
      ['Very Short', 'very short adult stature'],
      ['Short', 'short adult stature'],
      ['Average', 'average adult height'],
      ['Tall', 'tall adult stature'],
      ['Very Tall', 'extremely tall adult stature'],
  ] },
  { id: 'proportions', tab: 'Body', label: 'Proportions', options: [
      ['Natural', 'natural human proportions'],
      ['Tiny Torso', 'tiny compact torso with very long limbs'],
      ['Long Torso', 'very long torso with short limbs'],
      ['Huge Hands', 'comically oversized hands'],
      ['Tiny Hands', 'comically tiny hands'],
      ['Wide Shoulders', 'extremely wide shoulders'],
      ['Narrow Shoulders', 'extremely narrow shoulders'],
      ['Long Neck', 'elegantly exaggerated long neck'],
      ['No Visible Neck', 'head visually tucked into the shoulders'],
  ] },
  { id: 'neck', tab: 'Body', label: 'Neck Styling', options: [
      ['Bare', 'bare neck'],
      ['Tower Collar', 'towering architectural collar surrounding the neck'],
      ['Ruff', 'huge circular pleated ruff'],
      ['Stacked Rings', 'stacked metallic neck rings'],
      ['Bow Sculpture', 'oversized sculptural bow at the neck'],
      ['Feather Halo', 'soft feather halo around the neck'],
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
  { id: 'hair', tab: 'Style', label: 'Hair / Head Shape', options: [
      ['Bald', 'bald head'],
      ['Short Hair', 'short hair'],
      ['Sharp Bob', 'razor-sharp geometric bob haircut'],
      ['Sculpted Waves', 'carefully sculpted vintage waves'],
      ['Sculptural Wave Tower', 'towering glossy black hair sculpture rising two head-heights above the scalp in three oversized stacked S-shaped waves, with a giant curled crest; the entire tall hair sculpture visible in frame'],
      ['Monumental Hair', 'monumental cloud-shaped hair at least three times wider than the shoulders'],
      ['Cube Cut', 'impossibly precise cube-shaped haircut with sharp right-angle edges'],
      ['Sphere Cut', 'perfectly spherical globe-shaped haircut surrounding the head'],
      ['Wedge Cut', 'giant triangular wedge-shaped haircut with a razor-straight silhouette'],
      ['Tabletop', 'extremely wide perfectly flat tabletop haircut'],
      ['Spiral Tower', 'towering spiral haircut rising high above the head'],
      ['Crescent Cut', 'sculptural crescent-moon-shaped haircut'],
      ['Twin Discs', 'two enormous perfectly circular hair discs on either side of the head'],
      ['Zigzag Cut', 'bold lightning-bolt zigzag haircut with crisp geometric edges'],
      ['Anvil Cut', 'wide sculptural haircut shaped like an industrial anvil'],
      ['Donut Halo', 'enormous circular ring of hair floating around the head like a donut halo'],
      ['Tube Tower', 'extremely tall cylindrical tube-shaped haircut rising vertically'],
      ['Shelf Cut', 'enormous perfectly flat horizontal shelf haircut wider than the shoulders'],
      ['Long Hair', 'long flowing hair'],
      ['Afro', 'afro hairstyle'],
      ['Punk', 'punk mohawk hairstyle'],
      ['Fur / Mane', 'fur mane on head'],
      ['Tentacles', 'tentacles as hair'],
      ['Spines', 'spines as hair'],
      ['Antennae', 'two long expressive antennae'],
      ['Flowers', 'living flowers growing from the head'],
  ] },
  { id: 'hair_color', tab: 'Style', label: 'Hair Color', options: [
      ['Black', 'black hair'],
      ['Brown', 'brown hair'],
      ['Blonde', 'blonde hair'],
      ['Silver', 'silver hair'],
      ['White', 'white hair'],
      ['Copper', 'copper orange hair'],
      ['Acid Green', 'acid-green hair'],
      ['Electric Blue', 'electric-blue hair'],
      ['Burgundy', 'deep burgundy red hair'],
      ['Pink', 'bubblegum-pink hair'],
      ['Split Color', 'cleanly split two-tone hair'],
      ['Rainbow Stripe', 'one precise rainbow stripe through the hair'],
  ] },
  { id: 'wardrobe_style', tab: 'Style', label: 'Wardrobe World', options: [
      ['Office Surrealist', 'surreal corporate tailoring with absurd proportions'],
      ['Quilted Royalty', 'regal quilted couture with exaggerated volume'],
      ['Utility Pop', 'bright practical utility wear with playful hardware'],
      ['Domestic Futurist', 'retro-futurist clothes made from domestic materials'],
      ['Ceremonial Sportswear', 'sportswear treated like formal ceremonial dress'],
      ['Tiny Formalwear', 'deliberately undersized immaculate formal tailoring'],
      ['Soft Sculpture', 'wearable soft-sculpture fashion with rounded forms'],
      ['Weather Couture', 'fashion patterned like clouds, rain maps, and pressure systems'],
      ['Modern Basics', 'plain fitted crew-neck T-shirt with contemporary tight skinny jeans'],
  ] },
  { id: 'accessories', tab: 'Style', label: 'Accessories & Markings', options: [
      ['Geometric Veil', 'translucent geometric fashion veil'],
      ['Object Jewellery', 'miniature everyday-object jewellery'],
      ['Chrome Brows', 'graphic chrome lacquer eyebrows'],
      ['Receipt Ribbons', 'couture ribbons made from receipt-like paper'],
      ['Tiny Handbag', 'comically tiny silver handbag'],
      ['Tiny Teacup', 'delicately holding a miniature porcelain teacup'],
      ['Bug Head Mask', 'enormous iridescent jewel-beetle fashion helmet, visibly a wearable mask'],
      ['Tiny Sunglasses', 'comically tiny oval sunglasses'],
      ['Tiny Monocle', 'one comically tiny gold monocle'],
      ['Impossible Handbag', 'carrying an impractically shaped geometric handbag'],
      ['Tattoos', 'covered in tattoos'],
      ['Piercings', 'multiple piercings'],
      ['Scarification', 'ritual scarification marks'],
      ['Symbols / Markings', 'symbolic tribal markings'],
      ['Cyber Markings', 'cyberpunk circuit markings'],
  ] },
  { id: 'distinctive_features', tab: 'Style', label: 'Signature Prop', options: [
      ['Tiny Microphone', 'holding a comically tiny reporter microphone'],
      ['Giant Comb', 'carrying an enormous sculptural comb'],
      ['Pocket Weather Station', 'wearing a miniature portable weather station'],
      ['Sacred Stapler', 'presenting an ordinary stapler like a sacred artifact'],
      ['Snack Sceptre', 'holding a royal sceptre topped with one tiny snack'],
      ['Miniature Chair', 'carrying a perfect miniature chair'],
      ['Impossible Handbag', 'carrying an impractically shaped geometric handbag'],
      ['Receipt Train', 'a long flowing train made from receipt-like paper'],
      ['Miniature Thermos', 'holding a polished miniature thermos flask'],
      ['Miniature Cake', 'presenting a perfect miniature layer cake'],
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

function oneLine(value, max) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function optionPhrase(options, value) {
  return options.find(([label]) => label === value)?.[1] || '';
}

/** The creator premise stays separate from visual traits so an Oddling can host many scenes. */
export function oddlingIdentity(picks) {
  const parts = [];
  const name = oneLine(picks?.oddling_name, 40);
  const obsession = oneLine(picks?.oddling_obsession, 140);
  const rule = oneLine(picks?.oddling_rule, 160);
  const voice = optionPhrase(ODDLING_TONES, picks?.oddling_voice);
  const show = optionPhrase(ODDLING_SHOWS, picks?.oddling_show);
  if (name) parts.push(`fictional creator named ${name}`);
  if (obsession) parts.push(`obsessed with ${obsession}`);
  if (voice) parts.push(voice);
  if (show) parts.push(show);
  if (rule) parts.push(`immutable visual canon: ${rule}`);
  return parts;
}

/**
 * Base portrait, the chosen traits, then the user's own text. The user's text
 * is what gets cut to fit the gateway limit, never the character.
 */
export function buildCharacterPrompt(userText, picks) {
  const head = [CHARACTER_BASE, ...characterTraits(picks), ...oddlingIdentity(picks)].join(', ');
  const extra = String(userText || '').trim();
  if (!extra) return head.slice(0, PROMPT_MAX);
  return `${head}, ${extra}`.slice(0, PROMPT_MAX);
}

export const ODDLING_DRAFT_KEY = 'veyrnox_oddling_passport_v1';
const ODDLING_TEXT_FIELDS = ['oddling_name', 'oddling_obsession', 'oddling_rule'];

export function sanitizeOddlingPicks(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const clean = {};
  for (const group of CHARACTER_GROUPS) {
    if (group.options.some(([label]) => label === value[group.id])) clean[group.id] = value[group.id];
  }
  for (const key of ODDLING_TEXT_FIELDS) {
    const limit = key === 'oddling_name' ? 40 : key === 'oddling_rule' ? 160 : 140;
    const text = oneLine(value[key], limit);
    if (text) clean[key] = text;
  }
  if (ODDLING_TONES.some(([label]) => label === value.oddling_voice)) clean.oddling_voice = value.oddling_voice;
  if (ODDLING_SHOWS.some(([label]) => label === value.oddling_show)) clean.oddling_show = value.oddling_show;
  return clean;
}

export function writeOddlingDraft(storage, picks, now = Date.now()) {
  try {
    storage.setItem(ODDLING_DRAFT_KEY, JSON.stringify({ version: 1, savedAt: now, picks: sanitizeOddlingPicks(picks) }));
    return true;
  } catch {
    return false;
  }
}

export function readOddlingDraft(storage) {
  try {
    const draft = JSON.parse(storage.getItem(ODDLING_DRAFT_KEY));
    if (!draft || draft.version !== 1 || !Number.isFinite(draft.savedAt)) return null;
    return { savedAt: draft.savedAt, picks: sanitizeOddlingPicks(draft.picks) };
  } catch {
    return null;
  }
}

/** Only opt Create into a saved character when the user arrived via a passport handoff. */
export function readOddlingPassport(storage, search = '') {
  try {
    if (new URLSearchParams(String(search)).get('passport') !== '1') return null;
    return readOddlingDraft(storage);
  } catch {
    return null;
  }
}
