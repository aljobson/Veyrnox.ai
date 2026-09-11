// Muon v2 data constants — source of truth: platform_model.xlsx / handoff README
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

export const PLANS = [
  { id: 'starter', name: 'Starter', price: '$15', priceMo: 15, credits: 200,   creditsFmt: '200 cr',   note: '≈13 Wan clips or 40 fast drafts' },
  { id: 'plus',    name: 'Plus',    price: '$39', priceMo: 39, credits: 1000,  creditsFmt: '1,000 cr', note: '≈66 Wan clips · unlocks premium models', hot: true },
  { id: 'ultra',   name: 'Ultra',   price: '$99', priceMo: 99, credits: 3000,  creditsFmt: '3,000 cr', note: 'for daily publishing & 4K hero work' },
];

// Annual Plus: $390/yr (2 months free)
export const ANNUAL_PLUS = { price: '$390/yr', savings: '2 months free' };

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
// Ponytail: hand-authored copy — swap for CMS later. Muon voice: honesty first.

export const NAV_CATEGORIES = [
  { href: '/muon',              label: 'Explore' },
  { href: '/muon/video',        label: 'Video' },
  { href: '/muon/image',        label: 'Image' },
  { href: '/muon/audio',        label: 'Audio' },
  { href: '/muon/cinema',       label: 'Cinema Studio' },
  { href: '/muon/mcp',          label: 'MCP · CLI',      badge: 'NEW' },
  { href: '/muon/effects',      label: 'Effects',        badge: 'FREE' },
  { href: '/muon/pricing',      label: 'Pricing' },
  { href: '/muon/enterprise',   label: 'Enterprise' },
];

export const FEATURE_CARDS = [
  { key: 'astra',    kicker: 'MUON × ASTRA',       title: 'One prompt in. A playable world out.',  body: 'Story, mechanics, every asset — priced before you spend.',  bg: 'linear-gradient(135deg,#0e0620 0%,#3a0e6a 55%,#8b46e4 100%)' },
  { key: 'genjutsu', kicker: 'REALITY SWAP',        title: 'One upload. Every possible take.',       body: 'Motion transfer + object swap on your own footage.',        bg: 'linear-gradient(135deg,#0a1a2c 0%,#144a7a 55%,#3ec1e8 100%)' },
  { key: 'cinema',   kicker: 'CINEMA STUDIO 4.0',   title: 'A movie set on the page.',               body: 'Real cameras, real lenses. Type the shot, see the ledger.', bg: 'linear-gradient(160deg,#2b1a0a 0%,#7a4a1e 60%,#f0b060 100%)' },
  { key: 'effects',  kicker: 'MUON EFFECTS',        title: 'Viral presets, one tap.',                body: 'Wired to ChatGPT and Claude MCP. Free browse, credit to run.',bg: 'linear-gradient(135deg,#1b0632 0%,#5a0e6a 55%,#e4318f 100%)' },
  { key: 'super',    kicker: 'SUPERCOMPUTER',       title: 'One agent, every model.',                body: 'Pick by capability or price. The router does the rest.',     bg: 'linear-gradient(135deg,#08120b 0%,#0e3a1e 60%,#2ea258 100%)' },
];

export const PRODUCT_TILES = [
  { key: 'wan',      name: 'Wan 2.5',            kind: 'Video',  credits: 15,  hint: 'The default. Fast, cinematic.',   badge: 'TOP',       icon: '⚡' },
  { key: 'nano',     name: 'Nano Banana',        kind: 'Image',  credits: 5,   hint: 'Photoreal stills, seconds.',                        icon: '🍌' },
  { key: 'genjutsu', name: 'Reality Swap',       kind: 'Video',  credits: 20,  hint: 'One clip in, many versions.',    badge: 'NEW',       icon: '↺' },
  { key: 'mcp',      name: 'MCP · CLI',          kind: 'Agent',  credits: null,hint: 'Wire Muon into Claude Code.',                       icon: '⌘' },
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
  href: '/muon/pricing',
};

export const CONTEST = {
  eyebrow: 'LIVE NOW · 6 DAYS LEFT',
  title: 'Muon Launch Showcase · 10,000 credits',
  body: 'Make it in Cinema Studio and submit by Sep 17. Any genre, solo or team.',
  primary: { label: 'Start my film', href: '/muon/app/create' },
  secondary: { label: 'Read the brief', href: '/muon/contest' },
};
