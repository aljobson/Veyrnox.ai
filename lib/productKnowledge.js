import { AUTO_PRODUCT_DOCS, AUTO_PRODUCT_INVENTORY } from './generatedProductInventory.js';

const article = (value) => Object.freeze(value);

// Reviewed, product-owned help content. The model receives only the few
// articles relevant to the question; this is deliberately separate from the
// model prompt so the application remains the source of truth.
export const PRODUCT_KNOWLEDGE = Object.freeze([
  article({
    id: 'product-overview', title: 'Choose the right Veyrnox workspace', routes: ['/app'],
    keywords: ['start', 'overview', 'what can i do', 'help', 'feature', 'content types'], target: 'nav.explore', action: 'show_target',
    summary: 'Veyrnox has distinct workspaces for generation, AI chat, film planning, saved media, projects, local enhancement, publishing, Credits and account security.',
    steps: ['Use Create for one image, video or audio generation.', 'Use LLM Chat for text, research, prompt help and Studio skills.', 'Use Film Studio for a consistent multi-shot production plan.', 'Use Library to review, reuse, download or schedule finished work.'],
    facts: ['Projects, Enhance, Publish, Video Agent and Social Cinema can be preview- or deployment-gated. Vey should say when a feature is unavailable rather than promise access.'],
  }),
  article({
    id: 'explore-templates-models', title: 'Explore templates, models and tools', routes: ['/app', '/presets', '/models', '/tools'],
    keywords: ['explore', 'template', 'preset', 'model page', 'tools', 'inspiration', 'price list'], target: 'explore.presets', action: 'show_target',
    summary: 'Explore and Templates provide ready-made prompts linked to suitable models. Models lists every live catalog model and exact price; Tools focuses on models that start from a user file.',
    steps: ['Open a template to inspect its prompt and model.', 'Choose Use in Studio to hand the prompt to Create.', 'Review the final cost in Create before generating.'],
    facts: ['A retired or unavailable model link falls back to the first available ungated model. Opening a template never spends Credits.'],
  }),
  article({
    id: 'oddlings', title: 'Build a reusable Oddling character', routes: ['/app/oddlings'],
    keywords: ['oddling', 'character', 'character passport', 'reusable character', 'recurring character', 'visual canon', 'character design'], target: 'oddlings.builder', action: 'show_target',
    summary: 'Oddling Studio builds a fictional adult creator with a repeatable identity, silhouette, visual canon, voice and recurring show before handing a prompt draft to Create.',
    steps: ['Start from an original cast preset or edit every trait yourself.', 'Set the name, voice, audience hook, recurring show and never-drift visual canon.', 'Choose portrait or motion and review the generated prompt.', 'Save the passport, then use Continue to open the draft in Create and review the exact generation price.'],
    facts: ['Oddling Studio stores passports in this browser. Upload references stay local to the browser preview. Building and saving costs nothing; Credits can be spent only later when the user personally generates in Create.'],
  }),
  article({
    id: 'oddlings-history', title: 'Find saved Oddling passports', routes: ['/app/oddlings'],
    keywords: ['saved oddling', 'oddling history', 'saved passport', 'saved character passports', 'character history', 'find character', 'load oddling'], target: 'oddlings.history', action: 'activate_target',
    summary: 'The History view contains Oddling passports saved in the current browser and lets the user load one back into the editable builder.',
    steps: ['Open History.', 'Choose a saved passport.', 'Select Load and edit.', 'Review the character before continuing to Create.'],
    facts: ['Oddling passports are browser-local and are not account Library assets. Vey may open the History tab but never saves, overwrites or generates the character.'],
  }),
  article({
    id: 'create-image', title: 'Create an image', routes: ['/app/create'],
    keywords: ['create image', 'make image', 'make an image', 'generate image', 'photo', 'picture', 'illustration', 'image model'], target: 'create.models', action: 'show_target',
    summary: 'Create makes still images with image models, including text-to-image, image editing, upscaling and background tools when the selected model supports them.',
    steps: ['Choose an image model.', 'Write the subject, composition, lighting and visual style in the prompt.', 'Add a source image if the model requires one.', 'Choose aspect or image count when offered, check Total cost, then personally press Generate.'],
    facts: ['Some image models can create 1–4 images in one job. Source-file requirements and controls come from the live model catalog.'],
  }),
  article({
    id: 'create-video', title: 'Create a video', routes: ['/app/create'],
    keywords: ['create video', 'make video', 'generate video', 'image to video', 'text to video', 'clip', 'camera movement', 'duration'], target: 'create.prompt', action: 'focus_target',
    summary: 'Create makes short video clips from text or from a starting image/video, depending on the selected model.',
    steps: ['Choose a video model that matches text-to-video or image-to-video.', 'Describe the subject action, scene motion and camera movement.', 'Add the required source file.', 'Choose duration and aspect when offered, check Total cost, then personally press Generate.'],
    facts: ['Available durations are model-specific. A 10-second option can cost twice the 5-second price. Film Studio is better for planning several consistent shots.'],
  }),
  article({
    id: 'create-duration', title: 'Choose video duration and aspect', routes: ['/app/create'],
    keywords: ['duration', 'length', 'seconds', '5s', '10s', 'aspect ratio', 'vertical video', 'widescreen'], target: 'create.duration', action: 'show_target',
    summary: 'Duration and aspect controls appear only when the selected model supports those choices.',
    steps: ['Choose the video model first.', 'Select an offered duration and aspect.', 'Check Total cost again because a longer clip can cost more.', 'Generate only when the settings and price are right.'],
    facts: ['The live catalog is authoritative. A 10-second option can cost twice the 5-second price.'],
  }),
  article({
    id: 'create-audio', title: 'Create audio, speech or sound', routes: ['/app/create'],
    keywords: ['create audio', 'make audio', 'speech', 'voice', 'tts', 'text to speech', 'sound effect', 'music', 'lip sync'], target: 'create.models', action: 'show_target',
    summary: 'Create includes audio models for speech, dialogue, sound effects, music and audio-driven workflows such as lip sync when available in the live catalog.',
    steps: ['Choose an audio model.', 'Enter the requested script or sound description.', 'Upload speech, video or other source media if the model asks for it.', 'Check the displayed cost and personally press Generate.'],
    facts: ['Exact inputs vary by model. The model card and source picker are authoritative.'],
  }),
  article({
    id: 'create-sources', title: 'Upload and reuse source media', routes: ['/app/create'],
    keywords: ['upload', 'source image', 'source video', 'source audio', 'own file', 'from library', 'rights', 'consent'], target: 'create.upload', action: 'show_target',
    summary: 'Models that transform media show source pickers for images, video or audio. A Library image can also be reused as a source.',
    steps: ['Choose a compatible model first.', 'Pick a local file or From library.', 'Confirm the rights-and-consent attestation yourself.', 'Review the prompt and cost before generating.'],
    facts: ['Images accept PNG, JPEG or WebP up to 20 MB; video accepts MP4 up to 100 MB; speech accepts MP3 or WAV up to 20 MB. Vey never confirms consent.'],
  }),
  article({
    id: 'create-prompts', title: 'Write a strong generation prompt', routes: ['/app/create', '/app/chat'],
    keywords: ['prompt', 'write prompt', 'improve prompt', 'negative prompt', 'seed', 'describe'], target: 'create.prompt', action: 'focus_target',
    summary: 'A useful prompt states what should be present, how it should look, and—for video—what moves and how the camera moves.',
    steps: ['Name the main subject and action.', 'Describe location, composition, lighting, lens or art style.', 'For video, add timing, motion and camera direction.', 'Use a negative prompt or seed only when the selected model exposes those controls.'],
    facts: ['Prompt writer, Fix my prompt and Model picker Studio skills can help in LLM Chat.'],
  }),
  article({
    id: 'generation-cost-safety', title: 'Costs, generation and refunds', routes: ['/app/create', '/app/credits'],
    keywords: ['cost', 'price', 'credits', 'generate', 'refund', 'failed', 'free allowance', 'balance'], target: 'create.cost', action: 'show_target',
    summary: 'Create shows the exact cost before submission. Credits are debited only when the user presses Generate, and failed generation jobs refund automatically.',
    steps: ['Check Total cost.', 'Confirm the model, inputs and prompt.', 'Press Generate yourself.', 'Watch the job or leave it running; Library will show its result and status.'],
    facts: ['Eligible models may show a daily free allowance. Free Credits are spent before purchased Credits. Vey may point at Generate but can never press it.'],
  }),
  article({
    id: 'library', title: 'Use the Library', routes: ['/app/library'],
    keywords: ['library', 'generation history', 'finished generations', 'find work', 'filter', 'favourite', 'favorite', 'grid', 'list', 'job status'], target: 'library.filters', action: 'show_target',
    summary: 'Library contains the account’s media generation jobs, including queued, running, successful and failed items.',
    steps: ['Filter by status or media type.', 'Switch grid or list view and mark favourites.', 'Open a successful item to download, reuse, ask about it or schedule it.', 'Use Load older to fetch earlier account jobs.'],
    facts: ['The browser cache helps labels render quickly, but the signed-in account list is authoritative. Chat jobs are excluded. Generated assets have limited retention, so download important files.'],
  }),
  article({
    id: 'library-download-reuse', title: 'Download, reuse, edit or publish media', routes: ['/app/library'],
    keywords: ['download', 'save file', 'use again', 'reuse', 'ask about', 'edit clip', 'captions', 'schedule generation'], target: 'library.download', action: 'show_target',
    summary: 'Successful Library items expose actions for downloading and, where enabled, reuse, chat analysis, clip editing or social scheduling.',
    steps: ['Find the successful item.', 'Use Download to save the original result.', 'Use a reuse or Ask about action when shown.', 'Publishing and Clip Editor actions appear only when their features are enabled.'],
    facts: ['Download links are short-lived and checked against the signed-in account. Vey never publishes or deletes for the user.'],
  }),
  article({
    id: 'llm-chat', title: 'Use LLM Chat', routes: ['/app/chat'],
    keywords: ['chat', 'llm', 'ask ai', 'message', 'reply', 'thinking', 'web search', 'research'], target: 'chat.message', action: 'focus_target',
    summary: 'LLM Chat provides priced text replies from selectable models, with optional Thinking, Web search, Deep research and image understanding when supported.',
    steps: ['Choose a model and review its per-reply price.', 'Optionally enable capabilities or tools and attach media.', 'Type a message and check the final Send price.', 'Press Send yourself; Stop can interrupt a reply.'],
    facts: ['Stopping before text arrives refunds; stopping after text arrives keeps the partial text and charge. Provider cut-off after partial text keeps the text but refunds. Plain replies may qualify for a free allowance.'],
  }),
  article({
    id: 'chat-organisation', title: 'Organise and customise chats', routes: ['/app/chat'],
    keywords: ['persona', 'system prompt', 'instructions', 'rename chat', 'pin chat', 'folder', 'star reply', 'chat settings'], target: 'chat.settings', action: 'activate_target',
    summary: 'Chat supports personas, per-chat instructions, model filters, folders, pinning, renaming, deletion and starred replies.',
    steps: ['Use Chat settings to choose a persona, model and capabilities.', 'A persona applies only when starting a new chat.', 'Use the chat list to pin, rename, move or delete conversations.', 'Save instructions inside an existing chat when needed.'],
    facts: ['Unsent drafts are kept per chat in the browser. Deleting a chat deletes it; Vey never performs that action.'],
  }),
  article({
    id: 'studio-skills', title: 'Use Studio skills', routes: ['/app/chat', '/app/film-studio'],
    keywords: ['studio skill', 'prompt writer', 'fix prompt', 'model picker', 'assistant', 'film assistant'], target: 'chat.skills', action: 'show_target',
    summary: 'Studio skills are specialist chat starters for prompting, model choice and each Film Studio stage.',
    steps: ['Open a skill before a chat has started.', 'Answer its questions one at a time.', 'Review its final Studio draft.', 'Use Open in Studio, then personally generate from Create.'],
    facts: ['Skills can prepare drafts but cannot spend Credits, approve film references, lock identities or accept takes.'],
  }),
  article({
    id: 'film-studio', title: 'Plan a multi-shot film', routes: ['/app/film-studio'],
    keywords: ['film studio', 'film', 'movie', 'consistent character', 'same character', 'across shots', 'shot list', 'multi shot', 'storyboard'], target: 'film.overview', action: 'show_target',
    summary: 'Film Studio plans consistent characters, locations, props and prompts across a seven-stage production. It prepares shots; it does not generate or edit a whole film automatically.',
    steps: ['Choose the image and video workflows.', 'Create the studio and break the story into short shots.', 'Approve reference boards and build asset passports.', 'Run stress tests, build shot prompts, open each prompt in Create and record the result.'],
    facts: ['Work is browser-stored per signed-in account. Export before signing out. Media remains in Library or external tools and is referenced by identifiers.'],
  }),
  article({
    id: 'film-stages', title: 'Complete Film Studio stages', routes: ['/app/film-studio'],
    keywords: ['film setup', 'studio init', 'film breakdown', 'reference board', 'asset passport', 'stress test', 'shot prompt', 'film stage'], target: 'film.stages', action: 'show_target',
    summary: 'The Film Studio stages are Setup, Studio init, Film breakdown, Reference boards, Asset passports, Stress tests and Shot prompts.',
    steps: ['Complete the issues shown for the current stage.', 'Use the stage assistant for writing help.', 'Make human approval, lock and verdict decisions yourself.', 'Continue only when the stage gate is satisfied.'],
    facts: ['Locked identities require a new version to change. Prompt revisions change one line while keeping canonical descriptors. Accepted takes require recorded checks.'],
  }),
  article({
    id: 'film-export', title: 'Save, import and export Film Studio', routes: ['/app/film-studio'],
    keywords: ['export film', 'export studio', 'export my film studio', 'film json', 'studio folder', 'import studio', 'save film'], target: 'film.files', action: 'show_target',
    summary: 'Film Studio can export a validated JSON workspace or a complete production folder ZIP and can import a JSON workspace.',
    steps: ['Export JSON for a compact backup.', 'Download the studio folder for production documents and manifests.', 'Import JSON only after exporting work you want to keep.', 'Confirm replacement yourself.'],
    facts: ['The folder export references media; it does not download generated media.'],
  }),
  article({
    id: 'projects', title: 'Organise work with Projects', routes: ['/app/projects'],
    keywords: ['project', 'workspace', 'project document', 'new project', 'rename project'], target: 'projects.search', action: 'show_target',
    summary: 'Projects provide workspace-scoped containers for an idea and its project document.',
    steps: ['Choose a workspace.', 'Create or search for a project.', 'Open a project to edit its document.', 'Rename or delete only after reviewing the confirmation.'],
    facts: ['Projects are preview-gated. Deleting a project does not delete generated Library media.'],
  }),
  article({
    id: 'video-enhance', title: 'Enhance a short portrait video locally', routes: ['/app/enhance'],
    keywords: ['enhance', 'face filter', 'smooth video', 'video look', 'local preview'], target: 'enhance.upload', action: 'show_target',
    summary: 'Video Enhance is an experimental browser-local preview for short, single-person clips. It uses no Credits and keeps the source in the browser.',
    steps: ['Choose an MP4, WebM or MOV clip up to 100 MiB, 15 seconds and 1920px longest edge.', 'Preview original and enhanced frames.', 'Adjust smoothing, look and intensity.', 'Export and download when the browser supports the source codec.'],
    facts: ['This feature is preview-gated and may be unavailable. Some clips support preview but not browser export.'],
  }),
  article({
    id: 'video-agent', title: 'Plan a video from a brief', routes: ['/app/video-agent'],
    keywords: ['video agent', 'video brief', 'plan video', 'approve plan'], target: 'video_agent.brief', action: 'focus_target',
    summary: 'Video Agent turns a short brief into a proposed video plan before any generation is approved.',
    steps: ['Describe the subject, goal and feeling.', 'Choose an aspect ratio.', 'Review the proposed plan and estimated price.', 'Approve personally before any generation step.'],
    facts: ['Video Agent is feature-gated and currently not a generally available priced workflow.'],
  }),
  article({
    id: 'credits', title: 'Understand and buy Credits', routes: ['/app/credits'],
    keywords: ['buy credits', 'buy more credits', 'credit pack', 'top up', 'billing', 'balance', 'statement', 'invoice'], target: 'credits.packs', action: 'show_target',
    summary: 'One Credit balance covers every generation model and paid Chat reply. Credit Packs are one-off purchases and purchased Credits do not expire.',
    steps: ['Open Credits and review the balance.', 'Choose a Credit Pack.', 'Read and personally tick the supply-consent checkbox.', 'Open Stripe checkout and review tax and total before paying.'],
    facts: ['Free Credits are spent first and can expire. Failed work is returned as a separate statement movement. Vey never selects consent or buys a pack.'],
  }),
  article({
    id: 'account-security', title: 'Manage account security', routes: ['/app/account'],
    keywords: ['account', 'security', 'two factor', '2fa', 'mfa', 'passkey', 'password', 'signed in devices', 'session'], target: 'account.security', action: 'show_target',
    summary: 'Account & security manages authenticator-based 2FA, passkeys, password changes and signed-in devices.',
    steps: ['Set up and verify an authenticator if desired.', 'Add or remove named passkeys.', 'Request an email code before setting a new password.', 'Use device controls to end other sessions or sign out everywhere.'],
    facts: ['Security changes and device sign-outs require the user’s direct confirmation.'],
  }),
  article({
    id: 'account-referrals-data', title: 'Referrals and account data', routes: ['/app/account'],
    keywords: ['referral', 'refer friend', 'data export', 'delete account', 'privacy'], target: 'account.data', action: 'show_target',
    summary: 'Account may show a referral link and provides email drafts for data export or account deletion requests.',
    steps: ['Copy the referral link when the feature is enabled.', 'A qualifying friend’s first Pack can earn a delayed Credit reward.', 'Use Your data to draft an export or deletion email.', 'Send the email yourself to submit the request.'],
    facts: ['Referral rewards are Credits, not money, and normally release after 14 days if the purchase is not refunded or disputed. Vey never sends or confirms deletion requests.'],
  }),
  article({
    id: 'publish', title: 'Connect accounts and publish', routes: ['/app/publish'],
    keywords: ['publish', 'social account', 'connect instagram', 'connect youtube', 'connect tiktok', 'social media'], target: 'publish.accounts', action: 'show_target',
    summary: 'Veyrnox Publish connects supported social accounts, prepares posts from Library or device media, and tracks scheduled and published targets.',
    steps: ['Connect an available network and complete its provider consent.', 'Choose media and write the caption.', 'Select an account and choose Post now or a scheduled time.', 'Review the final post and personally submit or approve it.'],
    facts: ['Publish is deployment-gated and the free plan connects one account. TikTok receives a draft in the creator inbox. Platform availability and media rules vary. Vey never connects, posts, approves drafts or disconnects accounts.'],
  }),
  article({
    id: 'publish-compose', title: 'Compose and review social posts', routes: ['/app/publish'],
    keywords: ['schedule post', 'compose post', 'caption', 'brand draft', 'draft review', 'post now'], target: 'publish.composer', action: 'show_target',
    summary: 'The Publish composer uses one Library asset or an enabled device upload, caption text, selected accounts and a send time.',
    steps: ['Review brand drafts before approving a batch.', 'Choose compatible media.', 'Write text within each network’s limits.', 'Choose accounts and schedule time, then submit personally.'],
    facts: ['The API validates media type and text limits before queueing and uses idempotency protections against duplicate posts.'],
  }),
  article({
    id: 'publish-calendar-analytics', title: 'Publishing calendar and analytics', routes: ['/app/publish/calendar', '/app/publish/analytics'],
    keywords: ['publishing calendar', 'reschedule', 'publish analytics', 'social analytics', 'best time', 'insights'], target: 'publish.calendar', action: 'show_target',
    summary: 'Publish includes calendar views for scheduled posts and analytics for enabled networks.',
    steps: ['Use month, week or list calendar views.', 'A drag proposes a new time; confirm to save it.', 'Use Analytics date ranges to review per-network results and timing insights.'],
    facts: ['Calendar, analytics, insights and device uploads have separate deployment flags. Twitch statistics may be collected without appearing in the current analytics UI.'],
  }),
  article({
    id: 'admin-operations', title: 'Use the operations and review tools', routes: ['/app/admin', '/app/admin/violations', '/app/admin/cinema', '/app/admin/cinema/submissions'],
    keywords: ['admin', 'operations', 'metrics', 'content violation', 'cinema submission', 'publication queue', 'moderation'], target: 'admin.overview', action: 'show_target',
    summary: 'The admin area exposes operational metrics, content-violation records and gated Social Cinema creator or publication review tools.',
    steps: ['Open only the area your role permits.', 'Use account lookup and review evidence before recording a violation.', 'Review Cinema submissions and publication state under the Cinema gates.', 'Make every moderation or suspension decision yourself.'],
    facts: ['Admin routes require an authorised role and can also require Cloudflare Access, AAL2 and fresh MFA. Vey explains controls but never records violations, approves, suspends or changes publication state.'],
  }),
  article({
    id: 'mcp', title: 'Use the Veyrnox MCP connector', routes: ['/mcp'],
    keywords: ['mcp', 'connector', 'external ai', 'tool connection', 'api tool'], target: 'nav.credits', action: 'show_target',
    summary: 'The MCP connector lets a compatible AI client inspect models and prices, prepare work and request generation through focused tools. Paid generation uses the same Veyrnox Credits and requires an exact estimate and the user’s confirmation.',
    steps: ['Open the MCP page and follow its three connection steps.', 'Let the client inspect prices before any paid action.', 'Keep final spend confirmation under the user’s control.'],
    facts: ['MCP access uses the same Veyrnox account and Credits.'],
  }),
  article({
    id: 'social-cinema', title: 'Watch or create for Social Cinema', routes: ['/social-cinema'],
    keywords: ['social cinema', 'cinema pass', 'watch series', 'creator workspace', 'publish series'], target: 'nav.explore', action: 'show_target',
    summary: 'Social Cinema is a gated catalogue for episodic viewing and creator publication workflows.',
    steps: ['Browse available titles and episodes.', 'Open a title and use Play when the episode is available.', 'Creators use the separate creator workspace and publication review process.'],
    facts: ['Social Cinema and creator publishing are feature-gated. Profile publishing and voting may not yet be open.'],
  }),
]);

function normal(value) {
  return String(value || '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const AUTO_STOP_WORDS = new Set(['about', 'and', 'are', 'can', 'does', 'for', 'from', 'how', 'into', 'the', 'this', 'use', 'what', 'where', 'with', 'you', 'your']);

function searchWords(value) {
  return normal(value).split(' ').filter((word) => word.length > 2 && !AUTO_STOP_WORDS.has(word));
}

function routeMatches(pattern, pathname) {
  if (pattern === pathname) return true;
  const expression = pattern
    .split('/')
    .map((part) => (/^\[.+\]$/.test(part) ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`^${expression}$`).test(pathname);
}

function automaticScore(item, words, query, pathname) {
  const haystack = normal([
    item.title,
    ...(item.headings || []),
    ...(item.controls || []),
    ...(item.descriptions || []),
    item.text,
    item.route,
  ].filter(Boolean).join(' '));
  let score = item.route && routeMatches(item.route, pathname) ? 14 : 0;
  if (query && normal(item.title) && query.includes(normal(item.title))) score += 12;
  for (const word of words) if (haystack.includes(word)) score += 2;
  return score;
}

export function searchAutomaticProductKnowledge(question, pathname = '/app', limits = {}) {
  const query = normal(question);
  const words = searchWords(question);
  const routeLimit = limits.routes ?? 2;
  const documentLimit = limits.documents ?? 1;
  const rank = (items) => items
    .map((item, index) => ({ item, index, score: automaticScore(item, words, query, pathname) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ item }) => item);
  return {
    routes: rank(AUTO_PRODUCT_INVENTORY).slice(0, routeLimit),
    documents: rank(AUTO_PRODUCT_DOCS).slice(0, documentLimit),
  };
}

export function automaticProductKnowledgeContext(question, pathname) {
  const matches = searchAutomaticProductKnowledge(question, pathname);
  const sections = [];
  for (const entry of matches.routes) {
    const lines = [`AUTO-DISCOVERED PAGE: ${entry.title}`, `ROUTE: ${entry.route}`];
    if (entry.headings.length) lines.push(`SECTIONS: ${entry.headings.slice(0, 8).join('; ')}`);
    if (entry.controls.length) lines.push(`VISIBLE LABELS: ${entry.controls.slice(0, 12).join('; ')}`);
    if (entry.descriptions.length) lines.push(`PAGE COPY: ${entry.descriptions.slice(0, 3).join(' ')}`);
    sections.push(lines.join('\n'));
  }
  for (const entry of matches.documents) {
    sections.push(`APPROVED PRODUCT DOC: ${entry.title}\nSOURCE: ${entry.source}\nDETAILS: ${entry.text}`);
  }
  return sections.join('\n\n').slice(0, 3500);
}

export function searchProductKnowledge(question, pathname = '/app', limit = 4) {
  const query = normal(question);
  const phraseQuery = ` ${query} `;
  const words = new Set(query.split(' ').filter((word) => word.length > 2));
  const stopWords = new Set(['and', 'are', 'can', 'for', 'how', 'the', 'this', 'use', 'what', 'where', 'with', 'you', 'your']);
  const scored = PRODUCT_KNOWLEDGE.map((entry, index) => {
    let score = 0;
    for (const route of entry.routes) {
      if (pathname === route) score = Math.max(score, 4);
      else if (pathname.startsWith(`${route}/`)) score = Math.max(score, Math.min(5, 1 + route.split('/').filter(Boolean).length));
    }
    for (const keyword of entry.keywords) {
      const key = normal(keyword);
      if (phraseQuery.includes(` ${key} `)) score += key.includes(' ') ? 9 : 5;
      else if (!key.includes(' ') && words.has(key)) score += 1;
      else if (key.includes(' ')) {
        const meaningful = key.split(' ').filter((word) => word.length > 2 && !stopWords.has(word));
        if (meaningful.length >= 2 && meaningful.every((word) => words.has(word))) score += 6;
      }
    }
    if (query.includes(normal(entry.title))) score += 10;
    return { entry, score, index };
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  const matches = scored.filter((item) => item.score > 0).slice(0, limit).map((item) => item.entry);
  return matches.length ? matches : [PRODUCT_KNOWLEDGE[0]];
}

export function productKnowledgeContext(question, pathname, allowedTargets = []) {
  const allowed = new Set(allowedTargets);
  const reviewed = searchProductKnowledge(question, pathname).map((entry) => {
    const lines = [
      `ARTICLE: ${entry.title} (${entry.id})`,
      `SUMMARY: ${entry.summary}`,
      `STEPS: ${entry.steps.map((step, index) => `${index + 1}. ${step}`).join(' ')}`,
      `FACTS: ${entry.facts.join(' ')}`,
    ];
    if (entry.target && allowed.has(entry.target)) lines.push(`SAFE UI TARGET: ${entry.target}`);
    return lines.join('\n');
  }).join('\n\n');
  const automatic = automaticProductKnowledgeContext(question, pathname);
  return automatic ? `${reviewed}\n\n${automatic}` : reviewed;
}
