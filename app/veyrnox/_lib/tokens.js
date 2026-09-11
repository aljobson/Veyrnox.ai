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
  { href: '/veyrnox#wallet',    label: 'Wallet' },
  { href: '/veyrnox#studio',    label: 'Studio' },
  { href: '/veyrnox#models',    label: 'Models' },
  { href: '/veyrnox#community', label: 'Community' },
  { href: '/veyrnox/pricing',   label: 'Pricing' },
];

// Four surfaces = the marketing top-line: wallet, studio, models, payouts.
export const FEATURE_CARDS = [
  { key: 'wallet',
    kicker: 'WALLET',
    title: 'Multichain by default',
    body: 'BSC, Ethereum, Base, Solana. One address, one balance. Recover with a passkey, not a phrase.',
    bg: 'linear-gradient(135deg,#0a1a2c 0%,#144a7a 55%,#3ec1e8 100%)' },
  { key: 'studio',
    kicker: 'STUDIO',
    title: 'Image · video · voice',
    body: 'Prompt once, generate across the model shelf. No credits burn until you accept.',
    bg: 'linear-gradient(135deg,#1b0632 0%,#5a0e6a 55%,#e4318f 100%)' },
  { key: 'models',
    kicker: 'MODELS',
    title: 'Latest, always',
    body: 'Seedance, Nano Banana, Genjutsu, GPT-Image 2, Kling — routed by task, not brand.',
    bg: 'linear-gradient(160deg,#2b1a0a 0%,#7a4a1e 60%,#f0b060 100%)' },
  { key: 'payouts',
    kicker: 'PAYOUTS',
    title: 'Get paid on ship',
    body: 'Every asset is a receipt. Every sale settles to your wallet the second it clears.',
    bg: 'linear-gradient(135deg,#08120b 0%,#0e3a1e 55%,#2ea258 100%)' },
];

// Two workflow strips beneath the four-surface grid.
export const WORKFLOW_STRIPS = [
  { kicker: 'STUDIO · GENJUTSU', title: 'One upload in. Endless variants out.', body: 'Drop a photo, a rough sketch, or a still. Ship a campaign by lunch.',
    bg: 'linear-gradient(135deg,#1b0632 0%,#5a0e6a 55%,#e4318f 100%)' },
  { kicker: 'PAYOUTS · LIVE',     title: 'Sell it before you finish it.',        body: 'Pre-orders, drops, tips — all in your wallet the moment they clear.',
    bg: 'linear-gradient(135deg,#08120b 0%,#0e3a1e 55%,#2ea258 100%)' },
];

export const HERO_STATS = [
  { value: '128k+', label: 'creators shipping' },
  { value: '$4.2M', label: 'paid to date' },
  { value: '17',    label: 'chains supported' },
];

export const METRIC_STRIP = [
  { value: '$4.2M', label: 'PAID TO CREATORS' },
  { value: '0.3s',  label: 'AVG. SETTLEMENT' },
  { value: '17',    label: 'CHAINS ROUTED' },
  { value: '0%',    label: 'PLATFORM TAKE' },
];

export const MODEL_SHELF = [
  'Seedance 2.5', 'Nano Banana Pro', 'Genjutsu', 'GPT-Image 2',
  'Kling 2.5', 'Flux Kontext', 'Wan 2.2', 'Topaz',
  'Sora 2', 'Google Veo 3', 'Claude MCP', 'MiniMax',
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

// Four-column footer forest — matches shipping site's PRODUCT / CREATORS / COMPANY / LEGAL.
export const MORE_FEATURES = [
  { group: 'Product',   items: ['Wallet', 'Studio', 'Models', 'Payouts'] },
  { group: 'Creators',  items: ['Community', 'Academy', 'Contests', 'Referrals'] },
  { group: 'Company',   items: ['About', 'Careers', 'Press', 'Contact'] },
  { group: 'Legal',     items: ['Terms', 'Privacy', 'Security', 'Status'] },
];

export const FOOTER_TAGLINE = 'The AI-native wallet for creators. Ship, sell, settle — in one loop.';
export const FOOTER_STAMP   = `© ${new Date().getFullYear()} Veyrnox, Inc.`;

export const HERO_CHIP = 'LIVE · V1.0.1 SHIPPED';
