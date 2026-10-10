// Veyrnox.ai data constants — source of truth: platform_model.xlsx / handoff README
// Do not drift these numbers. Credit costs & plan prices are contractual.

// Active gateway catalog — kept in lockstep with fal rows exposed by
// /api/v1/generations and (once shipped) GET /api/v1/catalog.
// `durations` mirrors what GET /api/catalog derives from each model's
// capability record: only the wan and kling families can be asked for a 10s
// clip, so only they may be sold one. Keep these in step with
// lib/modelCapabilities.js — the fallback renders the same picker the live
// catalog does (tests/modelCapabilities.test.mjs checks it).
export const MODELS = [
  { id: 'wan-2.5-kie',        name: 'Wan 2.5',             credits: 19,  tag: 'RECOMMENDED', preselected: true, kind: 'video', durations: [5, 10] },
  { id: 'kling-2.6-pro-kie',  name: 'Kling 2.6 Pro',       credits: 17,                                         kind: 'video', durations: [5, 10] },
  { id: 'kling-3.0-i2v',      name: 'Kling 3.0 · I2V',     credits: 34,                                         kind: 'video', durations: [5, 10] },
  { id: 'seedance-2.0-fast',  name: 'Seedance 2.0 Fast',   credits: 28,                                         kind: 'video', durations: [5, 10] },
  { id: 'kling-avatar-v2',    name: 'Kling AI Avatar',     credits: 35,  tag: 'NEW',                            kind: 'video', durations: [5] },
  { id: 'latentsync',         name: 'LatentSync',          credits: 13,  tag: 'NEW',                            kind: 'video', durations: [5] },
  { id: 'hailuo-02-kie',      name: 'MiniMax Hailuo 02',   credits: 9,                                         kind: 'video', durations: [5] },
  { id: 'veo-3.1-kie',        name: 'Veo 3.1',             credits: 76,  tag: 'PREMIUM',    premium: true, gated: true, kind: 'video', durations: [5] },
  { id: 'veo-3.1-fast-kie',   name: 'Veo 3.1 Fast',        credits: 19,                                         kind: 'video', durations: [5] },
  { id: 'veo-3.1-lite-kie',   name: 'Veo 3.1 Lite',        credits: 10,                                         kind: 'video', durations: [5] },
  { id: 'nano-banana-pro-grsai', name: 'Nano Banana Pro',    credits: 2,   tag: 'NEW',                            kind: 'image', durations: [5] },
  { id: 'nano-banana-pro-edit', name: 'Nano Banana Pro Edit', credits: 10,                                      kind: 'image', durations: [5] },
  { id: 'nano-banana-kie',    name: 'Nano Banana',         credits: 2,                                         kind: 'image', durations: [5] },
  { id: 'sana-1.5-4.8b',     name: 'Sana v1.5 4.8B',      credits: 1,   tag: 'NEW',                            kind: 'image', durations: [5] },
  { id: 'flux-2-pro',         name: 'Flux.2 [pro]',        credits: 2,                                          kind: 'image', durations: [5] },
  { id: 'seedream-4',         name: 'Seedream 4',          credits: 2,                                          kind: 'image', durations: [5] },
  { id: 'topaz-upscale',      name: 'Topaz Upscale 2x',    credits: 5,                                          kind: 'image', durations: [5] },
  { id: 'bria-bg-remove',     name: 'Background Removal',  credits: 3,                                          kind: 'image', durations: [5] },
  { id: 'bria-expand',        name: 'Bria Expand',         credits: 3,                                          kind: 'image', durations: [5] },
  { id: 'ace-step',           name: 'ACE Step',            credits: 1,                                          kind: 'audio', durations: [5] },
  { id: 'ace-step-1.5',       name: 'ACE-Step 1.5',        credits: 3,                                          kind: 'audio', durations: [5] },
  { id: 'elevenlabs-sfx-v2',  name: 'ElevenLabs Sound Effects', credits: 2,                                     kind: 'audio', durations: [5] },
  { id: 'mmaudio-v2',         name: 'MMAudio v2',          credits: 1,                                          kind: 'audio', durations: [5] },
  { id: 'elevenlabs-tts-turbo', name: 'ElevenLabs TTS Turbo', credits: 4,                                       kind: 'audio', speech: true, durations: [5] },
  { id: 'minimax-speech-2.6-hd', name: 'MiniMax Speech 2.6 HD', credits: 7,                                     kind: 'audio', speech: true, durations: [5] },
  { id: 'inworld-tts',        name: 'Inworld TTS',         credits: 2,                                          kind: 'audio', speech: true, durations: [5] },
  { id: 'elevenlabs-dialogue', name: 'ElevenLabs Dialogue', credits: 7,  tag: 'NEW',                            kind: 'audio', speech: true, durations: [5] },
];

// 10s video = exactly 2x credits. Non-negotiable.
export const COST_MULTIPLIER_10S = 2;

/**
 * Collapse a `model_catalog.modality` to the coarse bucket the UI branches
 * on. The catalog is fine-grained ('text-to-video', 'image-to-video',
 * 'text-to-image', 'text-to-audio'); MODELS above is coarse, so every live
 * catalog read has to pass through here or the live and fallback paths
 * disagree — which is how the 10s video multiplier went missing once
 * already.
 *
 * Video is tested first on purpose: 'image-to-video' contains both words,
 * and it is a video. The default is the non-video bucket, so a modality we
 * have never seen can never accidentally earn the 10s price multiplier.
 */
export function kindOf(modality) {
  const m = String(modality || '').toLowerCase();
  if (m.includes('video')) return 'video';
  if (/audio|speech|tts|music/.test(m)) return 'audio';
  return 'image';
}

// Annual discounts mirror Higgsfield's structural shape (30% / 20% / 23%).
// Prices are Veyrnox's own — the shape is what's borrowed.


// Templates live in templates.js; re-exported so existing imports keep working.
export { PRESETS, PRESET_CATEGORIES, WALL_PRESETS, ALL_TEMPLATES, templatesIn, templateById, templateHref } from './templates.js';

// Preset names are stored upper-case for the studio's chips. Shown as a title
// they read better in title case, except for the acronyms they contain.
const PRESET_ACRONYMS = new Set(['CCTV', 'UGC', 'VFX', 'AI']);
const PRESET_SMALL_WORDS = new Set(['A', 'AN', 'AND', 'OF', 'THE', 'TO']);
export function presetTitle(name) {
  return String(name || '')
    .split(/(\s+)/)
    .map((w, i) => (PRESET_ACRONYMS.has(w) ? w
      : i > 0 && PRESET_SMALL_WORDS.has(w) ? w.toLowerCase()
      : w.charAt(0) + w.slice(1).toLowerCase()))
    .join('');
}

/**
 * PRESETS carry a model display name ("Wan 2.5"), the catalog carries ids
 * ("wan-2.5"). A preset card needs the id to preselect anything, so map it
 * here where both lists live. Returns null when the name has drifted — the
 * caller then links without a model rather than preselecting a wrong one.
 */
export function modelIdForName(name) {
  if (!name) return null;
  const want = String(name).trim().toLowerCase();
  const hit = MODELS.find((m) => m.name.toLowerCase() === want);
  return hit ? hit.id : null;
}

/**
 * Studio link for a preset: the model it is wired to (when that model is still
 * in the catalog) plus the preset id, so Create records which card sent the
 * user. Shared by the /presets gallery cards and the landing wall.
 */
export function presetHref(preset) {
  const modelId = modelIdForName(preset.model);
  return modelId
    ? `/app/create?model=${encodeURIComponent(modelId)}&preset=${encodeURIComponent(preset.id)}${preset.durationSeconds === 10 ? '&duration=10s' : ''}`
    : `/app/create?preset=${encodeURIComponent(preset.id)}`;
}

/**
 * The credits a preset is quoted at, anywhere it is shown. The live catalog is normative for prices
 * (CLAUDE.md), and the landing page already resolves its other tiles through
 * it, so a re-priced row must not be quoted at the old constant here. Falls
 * back to the preset's own figure when the catalog is missing, the model has
 * drifted out of it, or the row carries no numeric price.
 */
export function presetCredits(preset, catalog) {
  const id = modelIdForName(preset.model);
  const row = id && Array.isArray(catalog) ? catalog.find((m) => m.id === id) : null;
  const unit = row && typeof row.credits === 'number' ? row.credits : preset.credits;
  return unit * (preset.durationSeconds === 10 ? COST_MULTIPLIER_10S : 1);
}

export const ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:5', '21:9'];
export const RESOLUTIONS = ['1K', '2K', '4K'];

// ─── Landing-page content ────────────────────────────────────────────────
// Ponytail: hand-authored copy — swap for CMS later. Veyrnox voice: honesty first.

// Where support mail goes — the footer Contact row and the floating contact
// button both read it, so there is one address to change.
export const SUPPORT_EMAIL = 'legal@veyrnox.com';

export const NAV_CATEGORIES = [
  { href: '/social-cinema', label: 'Social Cinema' },
  { href: '/#explore',   label: 'Explore' },
  { href: '/#models',    label: 'Models' },
  { href: '/presets',   label: 'Templates' },
  { href: '/tools',     label: 'Tools' },
  { href: '/app/chat',  label: 'LLM Chat' },
  { href: '/pricing',   label: 'Pricing' },
  { href: '/#faq',       label: 'FAQ' },
];

// Every public route, with the blurb search and the 404 page reuse.
export const SITE_PAGES = [
  { href: '/social-cinema', label: 'Social Cinema', description: 'Episodic stories, community voting and upcoming series.' },
  { href: '/',                  label: 'Home',               description: 'Credit-metered AI image, video and audio generation.' },
  { href: '/pricing',           label: 'Pricing',            description: 'Every model, every credit price, one balance.' },
  { href: '/presets',           label: 'Templates',          description: 'Ready-made looks with their prompt and price up front.' },
  { href: '/tools',             label: 'Tools',              description: 'Upscale, cut out, expand, edit and animate your own files.' },
  { href: '/guides',            label: 'Guides',             description: 'Step-by-step answers to the things people do first.' },
  { href: '/app/chat',          label: 'LLM Chat',           description: 'Ask leading AI models, with Web search if you want it, priced before you send.' },
  { href: '/app/create',        label: 'Create',             description: 'The studio: pick a model, see the cost, generate.' },
  { href: '/app/library',       label: 'Library',            description: 'Every generation you have run, successes and refunds.' },
  { href: '/app/credits',       label: 'Credits & billing',  description: 'Your balance, free-credit expiry and recent ledger rows.' },
  { href: '/legal/terms',       label: 'Terms of Service',   description: 'The contract between you and Veyrnox Ltd.' },
  { href: '/legal/privacy',     label: 'Privacy Policy',     description: 'What we process, why, and for how long.' },
  { href: '/legal/gdpr',        label: 'GDPR & Data Rights', description: 'Access, export and deletion requests.' },
  { href: '/legal/refund',      label: 'Refund Policy',      description: 'When credits come back to your balance.' },
  { href: '/design-system',     label: 'Design system',      description: 'Colour, type and component reference.' },
];

// Featured hero cards — 5 wide, each opens a model or the preset gallery.
// Real active-catalog rows only. No Cinema Studio, no MCP·CLI (those live in
// a separate product, not here).
export const FEATURE_CARDS = [
  { key: 'wan-2.5-kie',
    kicker: 'WAN 2.5',
    title: 'The default. Fast, cinematic.',
    body: '5 seconds of 720p motion for 19 credits. The workhorse, priced on the button before you press it.',
    cta: 'Open Wan 2.5',
    href: '/app/create?model=wan-2.5-kie',
    bg: 'linear-gradient(135deg,#0a1a2c 0%,#144a7a 55%,#3ec1e8 100%)' },
  { key: 'nano-banana-kie',
    kicker: 'NANO BANANA',
    title: 'Photoreal stills, two credits a frame.',
    body: 'Photoreal images for product shots and stills, at two credits each.',
    cta: 'Open Nano Banana',
    href: '/app/create?model=nano-banana-kie',
    bg: 'linear-gradient(160deg,#2b1a0a 0%,#7a4a1e 60%,#f0b060 100%)' },
  { key: 'kling-26',
    kicker: 'KLING 2.6 PRO',
    title: 'Cinematic video, cost visible.',
    body: 'The go-to for narrative video work. 17 credits per 5-second shot, priced on the button.',
    cta: 'Open Kling',
    href: '/app/create?model=kling-2.6-pro-kie',
    bg: 'linear-gradient(135deg,#1b0632 0%,#5a0e6a 55%,#e4318f 100%)' },
  { key: 'presets',
    kicker: 'PRESETS',
    title: 'One-tap looks. Exact prices.',
    body: 'Curated looks wired to a model and a prompt, each showing its credit cost. Browse free, generate on-tap.',
    cta: 'Browse presets',
    href: '/presets',
    bg: 'linear-gradient(135deg,#0e0620 0%,#3a0e6a 55%,#8b46e4 100%)' },
  { key: 'ace-step',
    kicker: 'ACE STEP',
    title: 'Music and voice, priced up front.',
    body: 'Audio generation on the same credit balance. 1 credit per clip. See it before you spend.',
    cta: 'Open ACE Step',
    href: '/app/create?model=ace-step',
    bg: 'linear-gradient(135deg,#08120b 0%,#0e3a1e 55%,#2ea258 100%)' },
];


// FAQ — 10 Qs. Hedged where legal/policy is still in flight.
export const FAQ = [
  { q: 'What is Veyrnox.ai?',
    a: 'Veyrnox.ai is a credit-metered AI image, video and audio generation gateway. One balance across the whole catalog, price visible on the button, refund on failure.' },
  { q: 'Which models can I run?',
    a: 'Image, video, audio and speech models, all on one balance. Premium models (◆) are gated. The live list, with every price, is on Pricing.',
    link: { label: 'Pricing', href: '/pricing' } },
  { q: 'How do credits work?',
    a: 'Every generation names its cost on the button before you press it. Credits debit at submit. If the job fails at any point the credits return to your balance automatically.' },
  { q: 'Do I get free credits when I sign up?',
    a: 'Yes, 10 credits granted on sign-up. Each generation shows its credit price before you spend. No card required.' },
  { q: 'What happens if a generation fails?',
    a: 'Automatic refund, ledger-backed. Provider safety rejects, provider timeouts and model errors all refund. Failed rows still show in your Library so you can retry.' },
  { q: 'Can I use the output commercially?',
    a: "Outputs are yours to use commercially, subject to each model provider's licence.",
    link: { label: 'See our Terms of Service', href: '/legal/terms' } },
  { q: 'How do I exercise my data rights?',
    a: 'Access, export and deletion requests go through the Data Rights page.',
    link: { label: 'Data Rights', href: '/legal/gdpr' } },
  { q: 'Are outputs watermarked or signed?',
    a: 'Not today. We do not attach content credentials to generated files. Outputs are AI-generated, and where a platform or the law asks you to label them as such, that is on you for now. We will update this answer when signing ships.' },
  { q: 'Are there rate limits?',
    a: '10 generations per 60 seconds per account. If you hit it, the API returns 429 with a Retry-After header and no credit debit.' },
  { q: 'Do credits expire?',
    a: 'Purchased credits never expire. Free sign-up credits expire 90 days after grant if unused. Free credits are spent first.',
    link: { label: 'Refund Policy', href: '/legal/refund' } },
];






// Four-column footer forest (plus tools). Every listed model row is a real
// catalog entry so a follow-up wiring can link them by id.
export const MORE_FEATURES = [
  { group: 'Product',   items: [
    { label: 'Explore', href: '/#explore' },
    { label: 'Models',  href: '/#shelf' },
    { label: 'Pricing', href: '/pricing' },
    { label: 'Templates', href: '/presets' },
    { label: 'Tools', href: '/tools' },
    { label: 'Guides', href: '/guides' },
  ] },
  { group: 'Models',    items: [] }, // filled from the live catalog in page.js
  { group: 'Tools',     items: [
    { label: 'Image Generator', href: '/app/create?model=nano-banana-kie' },
    { label: 'Video Generator', href: '/app/create?model=wan-2.5-kie' },
    { label: 'Image-to-Video',  href: '/app/create?model=kling-3.0-i2v' },
    { label: 'Audio',           href: '/app/create?model=ace-step' },
    { label: 'Lip Sync',        href: '/app/create?model=latentsync' },
    { label: 'Text to Speech',  href: '/app/create?model=elevenlabs-tts-turbo' },
    { label: 'Upscale',         href: '/app/create?model=topaz-upscale' },
    { label: 'Background Removal', href: '/app/create?model=bria-bg-remove' },
  ] },
  // Items are either a plain string (a label, rendered muted so it does not
  // read as a link) or { label, href } (real route).
  { group: 'Company',   items: [
    { label: 'Terms',              href: '/legal/terms' },
    { label: 'Privacy',            href: '/legal/privacy' },
    { label: 'GDPR & Data Rights', href: '/legal/gdpr' },
    { label: 'Refund Policy',      href: '/legal/refund' },
    { label: 'Contact',            href: `mailto:${SUPPORT_EMAIL}` },
  ] },
];

export const FOOTER_TAGLINE = 'Credit-metered AI generation for creators. Priced on the button, refund on failure, always.';

// A function, not a constant. `new Date()` at module scope is evaluated once
// per Worker isolate — the footer showed whatever year the bundle happened to
// boot in and would have read 2026 all through 2027.
export function footerStamp() {
  return `© ${new Date().getFullYear()} Veyrnox Ltd`;
}


// Stamped on the pages that make claims about prices and policy, so a
// visitor can tell how fresh what they are reading is. Bump it when the
// marketing copy or the pricing story changes.
export const SITE_UPDATED = '2026-09-22';


// Shelf cards print the modality underneath the name, so the parenthetical in
// a catalog name ("Kling 3.0 (image-to-video)") is redundant for display.
export function shelfName(name) {
  return String(name || '').replace(/\s*\([^()]*\)\s*$/, '');
}

// Which catalog rows the public surfaces may advertise.
//
// The landing shelf and site search list the live catalog, but the picker in
// app/create does not sell every active row, and a shelf that offers what the
// picker hides sends a visitor looking for a product that is not there (audit
// 2026-09-23, finding 12: "Auto Short" was priced at 110 credits on the
// landing page while the picker kept it behind a flag).
//
// Three kinds of row are held back:
//   - edit tools (Clip Editor) — they act on Library files, not on a prompt,
//     so they belong in the Library, not on a shelf of models.
//   - topic rows (Auto Short) — gated behind localStorage.veyrnox_auto_short
//     in app/create until launch (CLAUDE.md "Delivery").
//   - plan rows (the video agent, ADR-0074) — bought from an approved plan on
//     its own page (app/video-agent), never from a prompt in the picker.
//
// Takes a capability record: `capabilityFor(row.provider_endpoint)` on the
// server, or the `capabilities` GET /api/catalog attaches to each row.
// When Auto Short launches, its gate in app/veyrnox/app/create/page.js and the
// `topic` clause below come out in the same commit.
export function isShelfModel(capabilities) {
  const inputs = (capabilities && capabilities.inputs) || {};
  return !(capabilities && capabilities.edit) && !inputs.clips && !inputs.topic && !inputs.plan_id;
}
