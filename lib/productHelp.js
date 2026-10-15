const TARGET_IDS = [
    'nav.explore',
    'nav.create',
    'nav.oddlings',
    'nav.chat',
    'nav.film',
    'nav.library',
    'nav.projects',
    'nav.enhance',
    'nav.credits',
    'nav.account',
    'nav.publish',
    'explore.presets',
    'create.prompt',
    'create.models',
    'create.duration',
    'create.aspect',
    'create.count',
    'create.consent',
    'create.character',
    'create.settings',
    'create.camera',
    'create.upload',
    'create.cost',
    'create.generate',
    'create.result',
    'oddlings.builder',
    'oddlings.reference',
    'oddlings.history',
    'oddlings.saved',
    'oddlings.prompt',
    'oddlings.continue',
    'chat.message',
    'chat.settings',
    'chat.threads',
    'chat.skills',
    'film.overview',
    'film.stages',
    'film.files',
    'library.filters',
    'library.download',
    'credits.packs',
    'credits.statement',
    'account.security',
    'account.data',
    'projects.search',
    'enhance.upload',
    'enhance.adjustments',
    'video_agent.brief',
    'publish.accounts',
    'publish.composer',
    'publish.calendar',
    'publish.analytics',
    'admin.overview',
];

const ACTION_IDS = ['none', 'show_target', 'focus_target', 'activate_target', 'open_create', 'open_library', 'open_credits', 'focus_prompt'];

export const HELP_TARGET_IDS = Object.freeze(TARGET_IDS);
export const HELP_ACTION_IDS = Object.freeze(ACTION_IDS);

// Selectors are owned by the product, never supplied by the model. A route
// may register several instances (for example, Download on each Library card);
// the first visible one is the one the helper introduces.
export const HELP_TARGETS = Object.freeze({
    'nav.explore': { route: '/app', selector: 'a[href="/app"]', label: 'Explore' },
    'nav.create': { route: '/app', selector: 'a[href="/app/create"]', label: 'Create' },
    'nav.oddlings': { route: '/app', selector: 'a[href="/app/oddlings"]', label: 'Oddling Studio' },
    'nav.chat': { route: '/app', selector: 'a[href="/app/chat"]', label: 'LLM Chat' },
    'nav.film': { route: '/app', selector: 'a[href="/app/film-studio"]', label: 'Film Studio' },
    'nav.library': { route: '/app', selector: 'a[href="/app/library"]', label: 'Library' },
    'nav.projects': { route: '/app', selector: 'a[href="/app/projects"]', label: 'Projects' },
    'nav.enhance': { route: '/app', selector: 'a[href="/app/enhance"]', label: 'Enhance' },
    'nav.credits': { route: '/app', selector: 'a[href="/app/credits"]', label: 'Credit balance' },
    'nav.account': { route: '/app/account', selector: 'h1', label: 'Account & security' },
    'nav.publish': { route: '/app/publish', selector: 'h1', label: 'Veyrnox Publish' },
    'explore.presets': { route: '/app', selector: 'a[href^="/presets/"]', label: 'Preset gallery' },
    'create.prompt': { route: '/app/create', selector: '[data-assistant-target="create.prompt"]', label: 'Prompt box' },
    'create.models': { route: '/app/create', selector: '[data-assistant-target="create.models"]', label: 'Model picker' },
    'create.duration': { route: '/app/create', selector: '[data-assistant-target="create.duration"]', label: 'Duration' },
    'create.aspect': { route: '/app/create', selector: '[data-assistant-target="create.aspect"]', label: 'Aspect ratio' },
    'create.count': { route: '/app/create', selector: '[data-assistant-target="create.count"]', label: 'Image count' },
    'create.consent': { route: '/app/create', selector: '[data-assistant-target="create.consent"]', label: 'Source rights and consent' },
    'create.character': { route: '/app/create', selector: '[data-assistant-target="create.character"]', label: 'Optional character controls' },
    'create.settings': { route: '/app/create', selector: '[data-assistant-target="create.settings"]', label: 'Optional generation settings' },
    'create.camera': { route: '/app/create', selector: '[data-assistant-target="create.camera"]', label: 'Optional camera controls' },
    'create.upload': { route: '/app/create', selector: '[data-assistant-target="create.upload"]', label: 'File picker' },
    'create.cost': { route: '/app/create', selector: '[data-assistant-target="create.cost"]', label: 'Total cost' },
    'create.generate': { route: '/app/create', selector: '[data-assistant-target="create.generate"]', label: 'Generate' },
    'create.result': { route: '/app/create', selector: '[data-assistant-target="create.result"]', label: 'Generation result' },
    'oddlings.builder': { route: '/app/oddlings', selector: '[data-assistant-target="oddlings.builder"]', label: 'Oddling builder' },
    'oddlings.reference': { route: '/app/oddlings', selector: '[data-assistant-target="oddlings.reference"]', label: 'Optional reference' },
    'oddlings.history': { route: '/app/oddlings', selector: '[data-assistant-target="oddlings.history"]', label: 'saved Oddlings', canActivate: true },
    'oddlings.saved': { route: '/app/oddlings', selector: '[data-assistant-target="oddlings.saved"]', label: 'selected saved passport' },
    'oddlings.prompt': { route: '/app/oddlings', selector: '[data-assistant-target="oddlings.prompt"]', label: 'generation prompt preview' },
    'oddlings.continue': { route: '/app/oddlings', selector: '[data-assistant-target="oddlings.continue"]', label: 'Continue to Create' },
    'chat.message': { route: '/app/chat', selector: '#chat-msg', label: 'Chat message' },
    'chat.settings': { route: '/app/chat', selector: '[aria-label="Chat settings"]', label: 'Chat settings', canActivate: true },
    'chat.threads': { route: '/app/chat', selector: 'nav[aria-label="Chats"]', label: 'Chat list' },
    'chat.skills': { route: '/app/chat', selector: 'section[aria-label="Studio skills"]', label: 'Studio skills' },
    'film.overview': { route: '/app/film-studio', selector: '[aria-labelledby="film-studio-how-to"]', label: 'Film Studio guide' },
    'film.stages': { route: '/app/film-studio', selector: 'nav[aria-label="Film Studio stages"]', label: 'Film Studio stages' },
    'film.files': { route: '/app/film-studio', selector: 'div:has(> div > label > input[aria-label="Import studio JSON"])', label: 'Film Studio import and export' },
    'library.filters': { route: '/app/library', selector: '[data-assistant-target="library.filters"]', label: 'Library filters' },
    'library.download': { route: '/app/library', selector: '[data-assistant-target="library.download"]', label: 'Download' },
    'credits.packs': { route: '/app/credits', selector: 'fieldset:has(input[name="credit-pack"])', label: 'Credit Packs' },
    'credits.statement': { route: '/app/credits', selector: '#credit-statement-title', label: 'Credit statement' },
    'account.security': { route: '/app/account', selector: 'h1', label: 'Account security' },
    'account.data': { route: '/app/account', selector: 'a[href^="mailto:privacy@veyrnox.com"]', label: 'Account data requests' },
    'projects.search': { route: '/app/projects', selector: 'input[placeholder="Search by name"]', label: 'Projects' },
    'enhance.upload': { route: '/app/enhance', selector: 'label:has(input[aria-label="Choose video"])', label: 'Choose video' },
    'enhance.adjustments': { route: '/app/enhance', selector: 'aside[aria-label="Adjustments"]', label: 'Enhance adjustments' },
    'video_agent.brief': { route: '/app/video-agent', selector: '#brief', label: 'Video brief' },
    'publish.accounts': { route: '/app/publish', selector: '[aria-label="Social platforms"]', label: 'Connected social accounts' },
    'publish.composer': { route: '/app/publish', selector: '#schedule', label: 'Create a post' },
    'publish.calendar': { route: '/app/publish/calendar', selector: '[aria-label="Calendar view"]', label: 'Publishing calendar' },
    'publish.analytics': { route: '/app/publish/analytics', selector: '[aria-label="Date range"]', label: 'Publishing analytics' },
    'admin.overview': { route: '/app/admin', selector: 'h1', label: 'Operations dashboard' },
});

export const HELP_ACTIONS = Object.freeze({
    show_target: { label: 'Show me' },
    focus_target: { label: 'Take me there', focus: true },
    activate_target: { label: 'Open it', activate: true },
    open_create: { route: '/app/create', label: 'Open Create' },
    open_library: { route: '/app/library', label: 'Open Library' },
    open_credits: { route: '/app/credits', label: 'Open Credits' },
    focus_prompt: { route: '/app/create', target: 'create.prompt', label: 'Start writing' },
});

export const HELP_STARTERS = Object.freeze([
    'What can I create in Veyrnox?',
    'Help me make my first image',
    'Where can I download my work?',
]);

const ROUTE_STARTERS = Object.freeze({
    '/models': ['Which model should I use?', 'How do model prices work?', 'Which models accept source files?'],
    '/presets': ['How do templates work?', 'How do I use a template in Create?', 'Does opening a template cost Credits?'],
    '/tools': ['Which tools use my own file?', 'How do source uploads work?', 'Where do I see the price?'],
    '/mcp': ['What can the MCP connector do?', 'How do I connect an AI client?', 'Can MCP spend my Credits?'],
    '/pricing': ['How do Credits work?', 'When do failed jobs refund?', 'Do purchased Credits expire?'],
    '/social-cinema': ['What is Social Cinema?', 'How do I watch an episode?', 'How do creator submissions work?'],
    '/app/create': ['How do I create a video?', 'Which content types can I make?', 'How do uploads and Credits work?'],
    '/app/oddlings': ['How do I build a reusable Oddling?', 'Where are my saved character passports?', 'How do I send this character to Create?'],
    '/app/chat': ['How does LLM Chat pricing work?', 'How do I use Web search or images?', 'What are Studio skills and personas?'],
    '/app/film-studio': ['Walk me through Film Studio', 'What should I complete at each stage?', 'How do I export and generate the shots?'],
    '/app/library': ['How do I find and download my work?', 'How do I reuse a generation?', 'What do the job statuses mean?'],
    '/app/credits': ['How do Credit Packs work?', 'Where can I see refunds?', 'Do Credits expire?'],
    '/app/account': ['How do I secure my account?', 'How do passkeys and 2FA work?', 'How do I request my data?'],
    '/app/projects': ['How do Projects work?', 'How do I create and find a project?', 'Does deleting a project delete my media?'],
    '/app/enhance': ['How does Video Enhance work?', 'Which video files can I use?', 'Does Enhance spend Credits?'],
    '/app/publish': ['How do I connect a social account?', 'How do I schedule a post?', 'What can Veyrnox Publish do?'],
    '/app/video-agent': ['How does Video Agent work?', 'How do I write a good video brief?', 'When does generation start?'],
    '/app/admin': ['What can I review here?', 'Which admin actions require fresh MFA?', 'How do moderation and Cinema review work?'],
});

export function helpStartersForPath(pathname = '/app') {
    const route = Object.keys(ROUTE_STARTERS)
        .sort((a, b) => b.length - a.length)
        .find((candidate) => pathname === candidate || pathname.startsWith(`${candidate}/`));
    return route ? ROUTE_STARTERS[route] : HELP_STARTERS;
}

export const HELP_PLAN_DEFAULT = Object.freeze({
    message: 'I can explain Create, uploads, Credits and your Library. Try asking where a control is or how to complete a task.',
    target: null,
    action: 'none',
});

/** Keep provider output inside the UI contract even if a model ignores its schema. */
export function normaliseHelpPlan(value) {
    const message = typeof value?.message === 'string' ? value.message.trim().slice(0, 700) : '';
    const target = TARGET_IDS.includes(value?.target) ? value.target : null;
    let action = ACTION_IDS.includes(value?.action) ? value.action : 'none';
    // Spending, deleting and publishing are deliberately absent. A model may
    // point at Generate, but it can never press it through this contract.
    if (target === 'create.generate') action = 'none';
    if (!target && (action === 'show_target' || action === 'focus_target')) action = 'none';
    if (action === 'focus_target' && !['create.prompt', 'chat.message', 'video_agent.brief'].includes(target)) action = 'show_target';
    if (action === 'activate_target' && !HELP_TARGETS[target]?.canActivate) action = target ? 'show_target' : 'none';
    return { message: message || HELP_PLAN_DEFAULT.message, target, action };
}

export function parseHelpRequest(value) {
    const question = typeof value?.question === 'string' ? value.question.trim() : '';
    const pathname = typeof value?.pathname === 'string' && (value.pathname === '/' || /^\/(?:app|models|presets|tools|guides|mcp|pricing|social-cinema|m|legal)(?:\/[-a-z0-9]+)*\/?$/i.test(value.pathname))
        ? value.pathname.slice(0, 160)
        : '/app';
    const targets = Array.isArray(value?.targets)
        ? [...new Set(value.targets.filter((id) => TARGET_IDS.includes(id)))].slice(0, TARGET_IDS.length)
        : [];
    const visibleTargets = Array.isArray(value?.visibleTargets)
        ? [...new Set(value.visibleTargets.filter((id) => TARGET_IDS.includes(id)))].slice(0, TARGET_IDS.length)
        : [];
    const history = Array.isArray(value?.history)
        ? value.history.slice(-6).flatMap((item) => {
            const role = item?.role === 'user' || item?.role === 'assistant' ? item.role : null;
            const content = typeof item?.content === 'string' ? item.content.trim().slice(0, role === 'user' ? 500 : 700) : '';
            return role && content ? [{ role, content }] : [];
        })
        : [];
    if (!question || question.length > 500) return { ok: false, error: 'invalid_question' };
    return { ok: true, question, pathname, targets, visibleTargets, history };
}

