// Veyrnox.ai data constants — source of truth: platform_model.xlsx / handoff README
// Do not drift these numbers. Credit costs & plan prices are contractual.

export const MODELS = [
  { id: 'wan-25',       name: 'Wan 2.5',            credits: 15,  tag: 'RECOMMENDED', preselected: true,  kind: 'video' },
  { id: 'seedance-fast',name: 'Seedance 2.0 Fast',  credits: 5,   tag: 'FASTEST',                          kind: 'video' },
  { id: 'seedance-lite',name: 'Seedance 1.0 Lite',  credits: 8,                                            kind: 'video' },
  { id: 'hailuo-02',    name: 'Hailuo 02',          credits: 20,                                           kind: 'video' },
  { id: 'kling-26pro',  name: 'Kling 2.6 Pro',      credits: 23,                                           kind: 'video' },
  { id: 'kling-30',     name: 'Kling 3.0',          credits: 33,  tag: '4K',                               kind: 'video' },
  { id: 'veo-31',       name: 'Veo 3.1',            credits: 125, tag: 'PREMIUM',    premium: true,        kind: 'video' },
  { id: 'flux-2-pro',   name: 'Flux.2 [pro]',       credits: 3,                                            kind: 'image' },
  { id: 'seedream-45',  name: 'Seedream 4.5',       credits: 3,                                            kind: 'image' },
  { id: 'nano-banana',  name: 'Nano Banana',        credits: 5,                                            kind: 'image' },
];

// 10s video = exactly 2x credits. Non-negotiable.
export const COST_MULTIPLIER_10S = 2;

// Annual discounts mirror Higgsfield's structural shape (30% / 20% / 23%).
// Prices are Veyrnox's own — the shape is what's borrowed.
export const PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    tagline: 'For first-time AI creators',
    priceMo: 15,
    priceAnnualMo: 11,        // 30% off billed annually
    annualDiscountPct: 30,
    credits: 200,
    creditsFmt: '200 cr',
    equivalence: '= 40 Nano Banana stills   ~ 13 Wan 2.5 clips',
    unlockedModels: [
      { name: 'Nano Banana', hint: 'image · 5 cr' },
      { name: 'Seedance 2.0 Fast', hint: 'video · 5 cr' },
      { name: 'Wan 2.5', hint: 'video · 15 cr' },
    ],
    lockedNote: 'Veo 3.1 & Kling 3.0 4K locked — upgrade to unlock',
    features: [
      'One balance across every unlocked model',
      'Failed jobs refund automatically',
      '2 concurrent jobs',
      'Preset library + prompt saves',
    ],
  },
  {
    id: 'plus',
    name: 'Plus',
    tagline: 'For everyday AI creation',
    priceMo: 39,
    priceAnnualMo: 31,        // 20% off
    annualDiscountPct: 20,
    credits: 1000,
    creditsFmt: '1,000 cr',
    equivalence: '= 200 Nano Banana stills   ~ 66 Wan 2.5 clips',
    hot: true,
    unlockedModels: [
      { name: 'Every image model', hint: 'Nano Banana, Flux.2, Seedream 4.5' },
      { name: 'Every standard video model', hint: 'Wan, Seedance, Hailuo, Kling 2.6' },
      { name: 'Kling 3.0 (up to 1080p)', hint: 'video · 33 cr / 5s' },
      { name: 'Veo 3.1', hint: '◆ premium · 125 cr / 5s' },
    ],
    lockedNote: 'Kling 3.0 4K & Ultra parallel unlocked at Ultra',
    features: [
      'One balance across every model',
      'Failed jobs refund automatically',
      '4 concurrent jobs',
      'MCP · CLI access · Supercomputer routing',
      'Priority queue',
    ],
  },
  {
    id: 'ultra',
    name: 'Ultra',
    tagline: 'For daily publishing & 4K hero work',
    badge: 'BEST VALUE',
    priceMo: 99,
    priceAnnualMo: 76,        // 23% off
    annualDiscountPct: 23,
    credits: 3000,
    creditsFmt: '3,000 cr',
    equivalence: '= 600 Nano Banana stills   ~ 200 Wan 2.5 clips',
    creditTiers: [
      { credits: 3000, priceMo: 99,  priceAnnualMo: 76  },
      { credits: 6000, priceMo: 179, priceAnnualMo: 138 },
      { credits: 9000, priceMo: 249, priceAnnualMo: 192 },
    ],
    unlockedModels: [
      { name: 'Every model', hint: 'including Veo 3.1 & Kling 3.0 4K' },
      { name: 'Kling 3.0 · 4K', hint: 'video · 66 cr / 5s' },
      { name: 'Veo 3.1', hint: '◆ premium · 125 cr / 5s' },
      { name: 'Cinema Studio 4.0', hint: 'full lens/camera library' },
    ],
    lockedNote: null,
    features: [
      'Everything in Plus',
      '8 concurrent jobs',
      '4K exports',
      'Highest priority queue',
      'Early access to new models',
    ],
  },
];

export const PLAN_TOGGLE = [
  { key: 'individual', label: 'Individual' },
  { key: 'business',   label: 'Business' },
];

// Higgsfield-shape per-resolution cost matrix.
// Veyrnox's own numbers — kept honest and derivable.
export const MODEL_COST_MATRIX = [
  { model: 'Wan 2.5',             kind: 'video', tag: 'RECOMMENDED', rows: [
    { label: '720p',  cost: 15 }, { label: '1080p', cost: 22 }, { label: '4K', cost: 44 },
  ]},
  { model: 'Seedance 2.0 Fast',   kind: 'video', tag: 'FASTEST',     rows: [
    { label: '720p',  cost: 5  }, { label: '1080p', cost: 8  }, { label: '4K', cost: null },
  ]},
  { model: 'Seedance 1.0 Lite',   kind: 'video', rows: [
    { label: '720p',  cost: 8  }, { label: '1080p', cost: 12 }, { label: '4K', cost: null },
  ]},
  { model: 'Hailuo 02',           kind: 'video', rows: [
    { label: '720p',  cost: 20 }, { label: '1080p', cost: 28 }, { label: '4K', cost: null },
  ]},
  { model: 'Kling 2.6 Pro',       kind: 'video', rows: [
    { label: '720p',  cost: 23 }, { label: '1080p', cost: 30 }, { label: '4K', cost: null },
  ]},
  { model: 'Kling 3.0',           kind: 'video', rows: [
    { label: '720p',  cost: 22 }, { label: '1080p', cost: 33 }, { label: '4K', cost: 66 },
  ]},
  { model: 'Veo 3.1',             kind: 'video', tag: '◆ PREMIUM',   rows: [
    { label: '720p',  cost: 80 }, { label: '1080p', cost: 125}, { label: '4K', cost: 250 },
  ]},
  { model: 'Nano Banana',         kind: 'image', rows: [
    { label: 'image', cost: 5  }, { label: null,     cost: null }, { label: null, cost: null },
  ]},
  { model: 'Flux.2 [pro]',        kind: 'image', rows: [
    { label: 'image', cost: 3  }, { label: null,     cost: null }, { label: null, cost: null },
  ]},
  { model: 'Seedream 4.5',        kind: 'image', rows: [
    { label: 'image', cost: 3  }, { label: null,     cost: null }, { label: null, cost: null },
  ]},
];

export const PRESET_CATEGORIES = ['ALL', 'CINEMATIC', 'UGC', 'VFX', 'ADS'];

export const PRESETS = [
  { id: 'crowd-surf', name: 'CROWD SURF',   model: 'Seedance 2.0 Fast', credits: 5,  category: 'UGC',        bg: 'linear-gradient(135deg,#0e2b3c 0%,#0a5a70 55%,#2ec8b3 100%)', views: '12.4k', cached: true, badge: 'CACHED' },
  { id: 'cctv-night', name: 'CCTV NIGHT',   model: 'Wan 2.5',           credits: 15, category: 'CINEMATIC',  bg: 'linear-gradient(180deg,#08120b 0%,#0e3a1e 60%,#2ea258 100%)', views: '8.7k',  cached: true, badge: 'CACHED' },
  { id: 'sunset-drift',name: 'SUNSET DRIFT', model: 'Hailuo 02',         credits: 20, category: 'CINEMATIC',  bg: 'linear-gradient(135deg,#2b1a0a 0%,#7a4a1e 60%,#f0b060 100%)', views: '9.1k',  cached: false },
  { id: 'neon-alley', name: 'NEON ALLEY',   model: 'Kling 2.6 Pro',     credits: 23, category: 'VFX',        bg: 'linear-gradient(135deg,#1b0632 0%,#5a0e6a 55%,#e4318f 100%)', views: '5.8k',  cached: true, badge: 'CACHED' },
  { id: 'warm-portrait',name: 'WARM PORTRAIT',model: 'Nano Banana',      credits: 5,  category: 'UGC',        bg: 'linear-gradient(160deg,#2c1a12 0%,#7a3520 60%,#c9713f 100%)', views: '2.9k' },
  { id: 'sports-cut', name: 'SPORTS CUT',   model: 'Seedance 2.0 Fast', credits: 5,  category: 'ADS',        bg: 'linear-gradient(135deg,#0a1a2c 0%,#144a7a 60%,#3ec1e8 100%)', views: '6.2k',  cached: true, badge: 'CACHED' },
];

export const ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:5', '21:9'];
export const DURATIONS = ['5s', '10s'];
export const RESOLUTIONS = ['1K', '2K', '4K'];

// ─── Landing-page content ────────────────────────────────────────────────
// Ponytail: hand-authored copy — swap for CMS later. Veyrnox voice: honesty first.

export const NAV_CATEGORIES = [
  { href: '/veyrnox',              label: 'Explore' },
  { href: '/veyrnox/video',        label: 'Video' },
  { href: '/veyrnox/image',        label: 'Image' },
  { href: '/veyrnox/audio',        label: 'Audio' },
  { href: '/veyrnox/cinema',       label: 'Cinema Studio' },
  { href: '/veyrnox/mcp',          label: 'MCP · CLI',      badge: 'NEW' },
  { href: '/veyrnox/effects',      label: 'Effects',        badge: 'FREE' },
  { href: '/veyrnox/pricing',      label: 'Pricing' },
  { href: '/veyrnox/enterprise',   label: 'Enterprise' },
];

export const FEATURE_CARDS = [
  { key: 'astra',    kicker: 'VEYRNOX × ASTRA',       title: 'One prompt in. A playable world out.',  body: 'Story, mechanics, every asset — priced before you spend.',  bg: 'linear-gradient(135deg,#0e0620 0%,#3a0e6a 55%,#8b46e4 100%)' },
  { key: 'genjutsu', kicker: 'REALITY SWAP',        title: 'One upload. Every possible take.',       body: 'Motion transfer + object swap on your own footage.',        bg: 'linear-gradient(135deg,#0a1a2c 0%,#144a7a 55%,#3ec1e8 100%)' },
  { key: 'cinema',   kicker: 'CINEMA STUDIO 4.0',   title: 'A movie set on the page.',               body: 'Real cameras, real lenses. Type the shot, see the ledger.', bg: 'linear-gradient(160deg,#2b1a0a 0%,#7a4a1e 60%,#f0b060 100%)' },
  { key: 'effects',  kicker: 'VEYRNOX EFFECTS',        title: 'Viral presets, one tap.',                body: 'Wired to ChatGPT and Claude MCP. Free browse, credit to run.',bg: 'linear-gradient(135deg,#1b0632 0%,#5a0e6a 55%,#e4318f 100%)' },
  { key: 'super',    kicker: 'SUPERCOMPUTER',       title: 'One agent, every model.',                body: 'Pick by capability or price. The router does the rest.',     bg: 'linear-gradient(135deg,#08120b 0%,#0e3a1e 60%,#2ea258 100%)' },
];

export const PRODUCT_TILES = [
  { key: 'wan',      name: 'Wan 2.5',            kind: 'Video',  credits: 15,  hint: 'The default. Fast, cinematic.',   badge: 'TOP',       icon: '⚡' },
  { key: 'nano',     name: 'Nano Banana',        kind: 'Image',  credits: 5,   hint: 'Photoreal stills, seconds.',                        icon: '🍌' },
  { key: 'genjutsu', name: 'Reality Swap',       kind: 'Video',  credits: 20,  hint: 'One clip in, many versions.',    badge: 'NEW',       icon: '↺' },
  { key: 'mcp',      name: 'MCP · CLI',          kind: 'Agent',  credits: null,hint: 'Wire Veyrnox into Claude Code.',                       icon: '⌘' },
  { key: 'cinema',   name: 'Cinema Studio 4.0',  kind: 'Suite',  credits: null,hint: 'Real cameras, lenses, apertures.',                  icon: '◉' },
  { key: 'super',    name: 'Supercomputer',      kind: 'Agent',  credits: 33,  hint: 'One agent to route them all.',                      icon: '☰' },
];

export const EFFECT_PRESETS = [
  { name: 'INCLINE',          bg: 'linear-gradient(135deg,#0e2b3c 0%,#0a5a70 55%,#2ec8b3 100%)' },
  { name: 'STUDIO SLIDE',     bg: 'linear-gradient(135deg,#1b0632 0%,#5a0e6a 55%,#e4318f 100%)' },
  { name: 'ACT NATURAL',      bg: 'linear-gradient(135deg,#2b1a0a 0%,#7a4a1e 55%,#f0b060 100%)' },
  { name: 'WORLD MORPH',      bg: 'linear-gradient(135deg,#08120b 0%,#0e3a1e 55%,#2ea258 100%)' },
  { name: 'LACEWALKER',       bg: 'linear-gradient(160deg,#2c1a12 0%,#7a3520 60%,#c9713f 100%)' },
  { name: 'WILD RIDE',        bg: 'linear-gradient(135deg,#0a1a2c 0%,#144a7a 55%,#3ec1e8 100%)' },
  { name: 'LIDAR CUT',        bg: 'linear-gradient(135deg,#0e0620 0%,#3a0e6a 55%,#8b46e4 100%)' },
  { name: 'SELF-VIEW',        bg: 'linear-gradient(135deg,#2b0a0a 0%,#7a1e1e 55%,#f06060 100%)' },
  { name: 'SMASH GRAB',       bg: 'linear-gradient(135deg,#1a0e2b 0%,#4a1e7a 55%,#c060f0 100%)' },
  { name: 'CLONES',           bg: 'linear-gradient(135deg,#0a2b1a 0%,#1e7a4a 55%,#60f0b0 100%)' },
  { name: 'FLOATING FALL',    bg: 'linear-gradient(135deg,#2b0a1a 0%,#7a1e4a 55%,#f060b0 100%)' },
  { name: 'EYES IN',          bg: 'linear-gradient(135deg,#0a1a1a 0%,#1e4a4a 55%,#60c0c0 100%)' },
  { name: 'VANISH',           bg: 'linear-gradient(135deg,#2b1a2b 0%,#5a2e5a 55%,#c060c0 100%)' },
  { name: 'INFINITE CLONES',  bg: 'linear-gradient(135deg,#0a1a2b 0%,#1e4a7a 55%,#60a0f0 100%)' },
  { name: 'CUTOUT',           bg: 'linear-gradient(135deg,#1a1a0a 0%,#4a4a1e 55%,#c0c060 100%)' },
];

export const CREATOR_PROJECTS = [
  { title: 'Detour',                    handle: '@aist',            likes: 261, views: '21.7K', bg: 'linear-gradient(135deg,#0a1a2c,#3ec1e8)' },
  { title: 'The Zero Slasher',          handle: '@zerotohero',      likes: 177, views: '17.0K', bg: 'linear-gradient(135deg,#2b0a0a,#f06060)' },
  { title: 'Fallen Leaves',             handle: '@jacob_everett',   likes: 323, views: '72.1K', bg: 'linear-gradient(135deg,#2b1a0a,#f0b060)' },
  { title: 'The Tortoise and the Hare', handle: '@benhamin',        likes: 239, views: '20.9K', bg: 'linear-gradient(135deg,#08120b,#2ea258)' },
  { title: 'VARMINTS · Bodas',          handle: '@outrealproduction',likes: 226,views: '15.0K', bg: 'linear-gradient(135deg,#1b0632,#e4318f)' },
  { title: 'APEIROPHOBIA',              handle: '@seksifratello',   likes: 216, views: '18.1K', bg: 'linear-gradient(135deg,#0e0620,#8b46e4)' },
  { title: 'Ballast',                   handle: '@lejardinier',     likes: 98,  views: '7.3K',  bg: 'linear-gradient(160deg,#2c1a12,#c9713f)' },
  { title: 'Azul Cobalto',              handle: '@seeyousoonx',     likes: 333, views: '143.6K',bg: 'linear-gradient(135deg,#0a2b1a,#60f0b0)' },
];

export const MORE_FEATURES = [
  { group: 'Create',        items: ['AI Video', 'AI Image', 'Edit Image', 'Inpaint', 'Upscale', 'Mixed Media', 'Face Swap', 'Character Studio'] },
  { group: 'Video Models',  items: ['Wan 2.5', 'Veo 3.1', 'Kling 3.0', 'Seedance 2.0', 'Hailuo 02', 'Kling 2.6 Pro'] },
  { group: 'Image Models',  items: ['Nano Banana', 'Flux.2 [pro]', 'Seedream 4.5', 'Flux Kontext'] },
  { group: 'Camera',        items: ['Camera Controls', 'Aperture', 'Focal Length', 'Anamorphic Set', '70mm Set', '16mm Set'] },
  { group: 'Cinema',        items: ['Cinema Studio', 'Cinema Presets', 'Motion Transfer', 'Object Swap', 'Depth Map', 'LiDAR Cut'] },
  { group: 'Publish',       items: ['TikTok', 'Instagram Reels', 'YouTube Shorts', 'Marketing Studio', 'Ad Multiplier'] },
  { group: 'Automate',      items: ['MCP · Claude', 'CLI', 'REST API', 'Webhooks', 'Recipes', 'Batch Run'] },
  { group: 'Community',     items: ['Explore', 'Contests', 'Creator Hub', 'Playbook', 'Discord'] },
];

export const PROMO_STRIP = {
  message: 'Early access — 200 credits on the house when you join the waitlist',
  cta: 'Claim credits',
  href: '/veyrnox/pricing',
};

export const CONTEST = {
  eyebrow: 'LIVE NOW · 6 DAYS LEFT',
  title: 'Veyrnox Launch Showcase · 10,000 credits',
  body: 'Make it in Cinema Studio and submit by Sep 17. Any genre, solo or team.',
  primary: { label: 'Start my film', href: '/veyrnox/app/create' },
  secondary: { label: 'Read the brief', href: '/veyrnox/contest' },
};
