// Veyrnox.ai data constants — source of truth: platform_model.xlsx / handoff README
// Do not drift these numbers. Credit costs & plan prices are contractual.

// Active gateway catalog — kept in lockstep with fal rows exposed by
// /api/v1/generations and (once shipped) GET /api/v1/catalog.
export const MODELS = [
  { id: 'wan-2.5',            name: 'Wan 2.5',             credits: 15,  tag: 'RECOMMENDED', preselected: true, kind: 'video' },
  { id: 'seedance-2.0-fast',  name: 'Seedance 2.0 Fast',   credits: 5,   tag: 'FASTEST',                        kind: 'video' },
  { id: 'kling-2.6-pro',      name: 'Kling 2.6 Pro',       credits: 23,                                         kind: 'video' },
  { id: 'kling-3.0-i2v',      name: 'Kling 3.0 · I2V',     credits: 33,  tag: '4K',                             kind: 'video' },
  { id: 'minimax-h3',         name: 'MiniMax H3',          credits: 22,                                         kind: 'video' },
  { id: 'veo-3.1',            name: 'Veo 3.1',             credits: 125, tag: 'PREMIUM',    premium: true, gated: true, kind: 'video' },
  { id: 'nano-banana',        name: 'Nano Banana',         credits: 6,                                          kind: 'image' },
  { id: 'flux-2-pro',         name: 'Flux.2 [pro]',        credits: 3,                                          kind: 'image' },
  { id: 'seedream-4',         name: 'Seedream 4',          credits: 3,                                          kind: 'image' },
  { id: 'ace-step',           name: 'ACE Step',            credits: 4,                                          kind: 'audio' },
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
      { name: 'Nano Banana', hint: 'image · 6 cr' },
      { name: 'Seedance 2.0 Fast', hint: 'video · 5 cr' },
      { name: 'Wan 2.5', hint: 'video · 15 cr' },
    ],
    lockedNote: 'Veo 3.1 ◆ premium locked — upgrade to unlock',
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
      { name: 'Every image model', hint: 'Nano Banana, Flux.2 [pro], Seedream 4' },
      { name: 'Every standard video model', hint: 'Wan, Seedance, MiniMax, Kling 2.6' },
      { name: 'Kling 3.0 · I2V', hint: 'video · 33 cr / 5s' },
      { name: 'Veo 3.1', hint: '◆ premium · 125 cr / 5s' },
      { name: 'ACE Step', hint: 'audio · 4 cr' },
    ],
    lockedNote: 'Higher concurrency and early access unlock at Ultra',
    features: [
      'One balance across every model',
      'Failed jobs refund automatically',
      '4 concurrent jobs',
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
      { name: 'Every model', hint: 'including Veo 3.1 ◆ and Kling 3.0 · I2V' },
      { name: 'Kling 3.0 · I2V', hint: 'video · 33 cr / 5s' },
      { name: 'Veo 3.1', hint: '◆ premium · 125 cr / 5s' },
      { name: 'Every image + audio model', hint: 'Nano Banana, Flux.2 [pro], Seedream 4, ACE Step' },
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

export const PRESET_CATEGORIES = ['ALL', 'CINEMATIC', 'UGC', 'VFX', 'ADS'];

export const PRESETS = [
  { id: 'crowd-surf', name: 'CROWD SURF',   model: 'Seedance 2.0 Fast', credits: 5,  category: 'UGC',        bg: 'linear-gradient(135deg,#0e2b3c 0%,#0a5a70 55%,#2ec8b3 100%)', views: '12.4k', cached: true, badge: 'CACHED' },
  { id: 'cctv-night', name: 'CCTV NIGHT',   model: 'Wan 2.5',           credits: 15, category: 'CINEMATIC',  bg: 'linear-gradient(180deg,#08120b 0%,#0e3a1e 60%,#2ea258 100%)', views: '8.7k',  cached: true, badge: 'CACHED' },
  { id: 'sunset-drift',name: 'SUNSET DRIFT', model: 'MiniMax H3',        credits: 22, category: 'CINEMATIC',  bg: 'linear-gradient(135deg,#2b1a0a 0%,#7a4a1e 60%,#f0b060 100%)', views: '9.1k',  cached: false },
  { id: 'neon-alley', name: 'NEON ALLEY',   model: 'Kling 2.6 Pro',     credits: 23, category: 'VFX',        bg: 'linear-gradient(135deg,#1b0632 0%,#5a0e6a 55%,#e4318f 100%)', views: '5.8k',  cached: true, badge: 'CACHED' },
  { id: 'warm-portrait',name: 'WARM PORTRAIT',model: 'Nano Banana',      credits: 6,  category: 'UGC',        bg: 'linear-gradient(160deg,#2c1a12 0%,#7a3520 60%,#c9713f 100%)', views: '2.9k' },
  { id: 'sports-cut', name: 'SPORTS CUT',   model: 'Seedance 2.0 Fast', credits: 5,  category: 'ADS',        bg: 'linear-gradient(135deg,#0a1a2c 0%,#144a7a 60%,#3ec1e8 100%)', views: '6.2k',  cached: true, badge: 'CACHED' },
];

export const ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:5', '21:9'];
export const DURATIONS = ['5s', '10s'];
export const RESOLUTIONS = ['1K', '2K', '4K'];

// ─── Landing-page content ────────────────────────────────────────────────
// Ponytail: hand-authored copy — swap for CMS later. Veyrnox voice: honesty first.

export const NAV_CATEGORIES = [
  { href: '/veyrnox#explore',   label: 'Explore' },
  { href: '/veyrnox#models',    label: 'Models' },
  { href: '/veyrnox/presets',   label: 'Presets' },
  { href: '/veyrnox/pricing',   label: 'Pricing' },
  { href: '/veyrnox#faq',       label: 'Docs' },
  { href: '/veyrnox#community', label: 'Community' },
];

// Featured hero cards — 5 wide, each opens a model or the preset gallery.
// Real active-catalog rows only. No Cinema Studio, no MCP·CLI (those live in
// a separate product, not here).
export const FEATURE_CARDS = [
  { key: 'seedance-fast',
    kicker: 'SEEDANCE 2.0 FAST',
    title: 'Fastest video model on the shelf.',
    body: '5 seconds of motion for 5 credits. Sharp, safe, quick — perfect for drafting.',
    cta: 'Open Seedance',
    href: '/veyrnox/app/create?model=seedance-2.0-fast',
    bg: 'linear-gradient(135deg,#0a1a2c 0%,#144a7a 55%,#3ec1e8 100%)' },
  { key: 'nano-banana',
    kicker: 'NANO BANANA',
    title: 'Photoreal stills, six credits a frame.',
    body: 'The cheapest photoreal image on the catalog. Perfect for product shots and stills.',
    cta: 'Open Nano Banana',
    href: '/veyrnox/app/create?model=nano-banana',
    bg: 'linear-gradient(160deg,#2b1a0a 0%,#7a4a1e 60%,#f0b060 100%)' },
  { key: 'kling-26',
    kicker: 'KLING 2.6 PRO',
    title: 'Cinematic video, cost visible.',
    body: 'The go-to for narrative video work. 23 credits per 5-second shot, priced on the button.',
    cta: 'Open Kling',
    href: '/veyrnox/app/create?model=kling-2.6-pro',
    bg: 'linear-gradient(135deg,#1b0632 0%,#5a0e6a 55%,#e4318f 100%)' },
  { key: 'presets',
    kicker: 'PRESETS',
    title: 'One-tap looks. Exact prices.',
    body: '15 curated preset gradients wired to model + prompt combos. Browse free, generate on-tap.',
    cta: 'Browse presets',
    href: '/veyrnox/presets',
    bg: 'linear-gradient(135deg,#0e0620 0%,#3a0e6a 55%,#8b46e4 100%)' },
  { key: 'ace-step',
    kicker: 'ACE STEP',
    title: 'Music and voice, priced up front.',
    body: 'Audio generation on the same credit balance. 4 credits per clip — see it before you spend.',
    cta: 'Open ACE Step',
    href: '/veyrnox/app/create?model=ace-step',
    bg: 'linear-gradient(135deg,#08120b 0%,#0e3a1e 55%,#2ea258 100%)' },
];

// Four "Why Veyrnox" pillars, Muapi-style: kicker + stat + body.
export const PILLARS = [
  { key: 'honest',
    kicker: 'HONEST PRICING',
    stat:   'ON THE BUTTON',
    title:  'See the cost before you press generate.',
    body:   'Every model shows its exact credit price on the button. No hidden multipliers. No surprise bills. One balance across the whole catalog.' },
  { key: 'refund',
    kicker: 'REFUND ON FAILURE',
    stat:   '100%',
    title:  'Failed jobs refund automatically.',
    body:   'Moderation reject, provider timeout, model error — credits return to your balance the moment we know. Ledger-backed and auditable.' },
  { key: 'balance',
    kicker: 'ONE BALANCE',
    stat:   'ALL MODELS',
    title:  'One credit balance across the catalog.',
    body:   'Image, video and audio models draw from a single balance. No add-ons, no per-model top-ups, no surprise bills.' },
  { key: 'c2pa',
    kicker: 'C2PA-SIGNED',
    stat:   'EVERY ASSET',
    title:  'Provenance signed at generation.',
    body:   'Every image, video and audio clip ships with a C2PA signature. Verifiable origin, model and creator — auditable by default.' },
];

// FAQ — Muapi-style, 10 Qs. Hedged where legal/policy is still in flight.
export const FAQ = [
  { q: 'What is Veyrnox.ai?',
    a: 'Veyrnox.ai is a credit-metered AI image, video and audio generation gateway. One balance across the whole catalog, price visible on the button, refund on failure.' },
  { q: 'Which models can I run?',
    a: 'Nano Banana, Wan 2.5, Seedance 2.0 Fast, Kling 2.6 Pro, Kling 3.0 I2V, MiniMax H3, Seedream 4, Flux.2 [pro], Veo 3.1 (◆ premium, gated), and ACE Step for audio. The full catalog is live on Pricing.' },
  { q: 'How do credits work?',
    a: 'Every generation names its cost on the button before you press it. Credits debit at submit. If the job fails at any point the credits return to your balance automatically.' },
  { q: 'Do I get free credits when I sign up?',
    a: 'Yes — 50 credits granted on sign-up. Enough for around 8 Nano Banana stills or 10 Seedance 2.0 Fast drafts. No card required.' },
  { q: 'What happens if a generation fails?',
    a: 'Automatic refund, ledger-backed. Moderation rejects, provider timeouts and model errors all refund. Failed rows still show in your Library so you can retry.' },
  { q: 'Can I use the output commercially?',
    a: "Outputs are yours to use commercially, subject to each model provider's licence.",
    link: { label: 'See our Terms of Service', href: '/legal/terms' } },
  { q: 'How do I exercise my data rights?',
    a: 'Access, export and deletion requests go through the Data Rights page.',
    link: { label: 'Data Rights', href: '/legal/gdpr' } },
  { q: 'Is the output signed?',
    a: 'Yes. Every asset carries a C2PA signature with model, creator and timestamp. Verifiable with any C2PA reader.' },
  { q: 'Are there rate limits?',
    a: '10 generations per 60 seconds per account. If you hit it, the API returns 429 with a Retry-After header and no credit debit.' },
  { q: 'Do credits expire?',
    a: 'Purchased credits never expire. Free sign-up credits expire 90 days after grant if unused. Free credits are spent first.',
    link: { label: 'Refund Policy', href: '/legal/refund' } },
];

// Two workflow strips beneath the four-surface grid.
export const WORKFLOW_STRIPS = [
  { kicker: 'STUDIO · GENJUTSU',
    title: 'One upload in. Endless variants out.',
    body: 'Drop a photo, a rough sketch, or a still. Ship a campaign by lunch — every variant priced before you press generate.',
    bg: 'linear-gradient(135deg,#1b0632 0%,#5a0e6a 55%,#e4318f 100%)' },
  { kicker: 'CREDITS · HONEST',
    title: 'The button is the price tag.',
    body: 'Every generation names its cost. Failed jobs refund automatically. One balance across the whole catalog — every price visible before you spend.',
    bg: 'linear-gradient(135deg,#0a1a2c 0%,#144a7a 55%,#3ec1e8 100%)' },
];

export const HERO_STATS = [
  { value: '50',    label: 'free credits on sign-up' },
  { value: '10+',   label: 'models on one balance' },
  { value: 'C2PA',  label: 'signed at source' },
];

export const METRIC_STRIP = [
  { value: '50',    label: 'FREE CREDITS ON SIGN-UP' },
  { value: '100%',  label: 'REFUND ON FAILURE' },
  { value: '10+',   label: 'MODELS ROUTED' },
  { value: 'C2PA',  label: 'SIGNED AT SOURCE' },
];

export const MODEL_SHELF = [
  'Seedance 2.5', 'Nano Banana Pro', 'Genjutsu', 'GPT-Image 2',
  'Kling 2.5', 'Flux Kontext', 'Wan 2.2', 'Topaz',
  'Sora 2', 'Google Veo 3', 'Claude MCP', 'MiniMax',
];

// Real active catalog rows — matches fal-side gateway rows so the pricing
// on the tiles is honest at build time. Wire to /api/catalog for live
// updates in a follow-up.
export const PRODUCT_TILES = [
  { key: 'wan-2.5',           name: 'Wan 2.5',            kind: 'Video',  credits: 15,  hint: 'The default. Fast, cinematic.',                    badge: 'TOP',       icon: '⚡' },
  { key: 'nano-banana',       name: 'Nano Banana',        kind: 'Image',  credits: 6,   hint: 'Cheapest photoreal frame on the shelf.',                                 icon: '◐' },
  { key: 'seedance-2.0-fast', name: 'Seedance 2.0 Fast',  kind: 'Video',  credits: 5,   hint: 'Fastest draft cycle for shorts.',                                        icon: '⇢' },
  { key: 'kling-3.0-i2v',     name: 'Kling 3.0 · I2V',    kind: 'Video',  credits: 33,  hint: '4K image-to-video, cinematic grade.',              badge: 'NEW',       icon: '▶' },
  { key: 'veo-3.1',           name: 'Veo 3.1',            kind: 'Video',  credits: 125, hint: 'Premium video (◆). Sign-up required, gated.',      badge: 'PREMIUM',   icon: '◆' },
  { key: 'ace-step',          name: 'ACE Step',           kind: 'Audio',  credits: 4,   hint: 'Music and voice generation on the same balance.',                        icon: '♪' },
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

// Four-column footer forest (plus tools). Every listed model row is a real
// catalog entry so a follow-up wiring can link them by id.
export const MORE_FEATURES = [
  { group: 'Product',   items: ['Explore', 'Models', 'Pricing', 'Presets', 'Status'] },
  { group: 'Models',    items: ['Wan 2.5', 'Nano Banana', 'Seedance 2.0 Fast', 'Kling 2.6 Pro', 'Kling 3.0 I2V', 'MiniMax H3', 'Seedream 4', 'Flux.2 [pro]', 'Veo 3.1 ◆', 'ACE Step'] },
  { group: 'Tools',     items: ['Image Generator', 'Video Generator', 'Image-to-Video', 'Audio', 'Upscaler'] },
  // Items are either a plain string (static label — page not shipped yet)
  // or { label, href } (real route). About / Contact stay static until
  // those pages exist.
  { group: 'Company',   items: [
    'About',
    { label: 'Terms',              href: '/legal/terms' },
    { label: 'Privacy',            href: '/legal/privacy' },
    { label: 'GDPR & Data Rights', href: '/legal/gdpr' },
    { label: 'Refund Policy',      href: '/legal/refund' },
    'Contact',
  ] },
];

export const FOOTER_TAGLINE = 'Credit-metered AI generation for creators. Priced on the button — refund on failure, always. C2PA-signed.';
export const FOOTER_STAMP   = `© ${new Date().getFullYear()} Veyrnox Ltd`;

export const HERO_CHIP = 'LIVE · V1.0.1 SHIPPED';

// Amber promo strip above the nav.
export const PROMO_STRIP = {
  message: '50 free credits on sign-up · no charge for failed generations',
  cta: 'Sign up free',
  href: '/veyrnox/app',
};
