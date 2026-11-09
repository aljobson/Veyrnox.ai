// First-runner tours: one short tour per feature, shown the first time a signed-in
// person opens it. A tour only points and explains. It never fills, clicks or submits.
// Selectors are owned here, never supplied by a model or by user input.
// A step whose control is not on screen (a model without sources, an empty Library) is skipped.

export const TOUR_STORAGE_PREFIX = 'veyrnox_feature_tours_v1:';
export const TOUR_REPLAY_EVENT = 'veyrnox:replay-feature-tour';

const target = (id) => `[data-assistant-target="${id}"]`;
const testid = (id) => `[data-testid="${id}"]`;

export const FEATURE_TOURS = Object.freeze([
    {
        id: 'explore', route: '/app', exact: true, name: 'Explore',
        steps: [
            { selector: 'a[href^="/presets/"]', title: 'Start from a preset', message: 'Click any preset to open it. The best model is already chosen and the price is shown before you spend anything.' },
            { selector: 'a[href="/app/create"]', title: 'Or write your own', message: 'Click Create to describe an image or video yourself.' },
            { selector: 'a[href="/app/credits"]', title: 'Your credit balance', message: 'Click your balance to top up or subscribe. Every price is shown before you generate.' },
        ],
    },
    {
        id: 'create', route: '/app/create', name: 'Create',
        steps: [
            { selector: target('create.models'), title: 'Click a model', message: 'Click a model to pick it. Its price and any free allowance appear beside it.' },
            { selector: target('create.prompt'), title: 'Type your prompt', message: 'Click in the box and describe the subject, style and lighting.' },
            { selector: target('create.upload'), title: 'Add a source file', message: 'This model accepts source files. Click to upload yours or choose one from your library.', optional: true },
            { selector: target('create.duration'), title: 'Pick a length', message: 'Click a duration. Longer clips cost more.', optional: true },
            { selector: target('create.aspect'), title: 'Pick a shape', message: 'Click an aspect ratio, for example 16:9 for landscape or 9:16 for portrait.', optional: true },
            { selector: target('create.cost'), title: 'Check the price', message: 'The total updates as you change things. Nothing is charged until you press Generate.' },
            { selector: target('create.generate'), title: 'Press Generate', message: 'Click Generate when you are happy. Your result appears here and in Library.' },
        ],
    },
    {
        id: 'chat', route: '/app/chat', name: 'LLM Chat',
        steps: [
            { selector: '#chat-msg', title: 'Type a message', message: 'Click here, write your question or idea and send it.' },
            { selector: target('chat.threads'), title: 'Your conversations', message: 'Click a past conversation to reopen it, or start a new one.', optional: true },
            { selector: target('chat.settings'), title: 'Model and settings', message: 'Click to change the model or how the reply is written.', optional: true },
            { selector: target('chat.skills'), title: 'Studio skills', message: 'Click a skill to give Chat a ready-made job, such as writing a shot list.', optional: true },
        ],
    },
    {
        id: 'oddlings', route: '/app/oddlings', name: 'Oddling Studio',
        steps: [
            { selector: target('oddlings.builder'), title: 'Build a character', message: 'Click through the options to design your Oddling. Nothing is charged while you design.' },
            { selector: target('oddlings.reference'), title: 'Add a reference', message: 'Optionally click to add a picture to guide the look.', optional: true },
            { selector: target('oddlings.prompt'), title: 'See the prompt', message: 'This is the description that will be sent when you generate.', optional: true },
            { selector: target('oddlings.history'), title: 'Saved characters', message: 'Click a saved version to load and edit it.', optional: true },
            { selector: target('oddlings.continue'), title: 'Continue to Create', message: 'Click to carry your character into Create and generate a portrait.', optional: true },
        ],
    },
    {
        id: 'film-studio', route: '/app/film-studio', name: 'Film Studio',
        steps: [
            { selector: '[aria-labelledby="film-studio-how-to"]', title: 'How Film Studio works', message: 'Read this short guide first. It explains each stage in order.' },
            { selector: target('film.stages'), title: 'Work through the stages', message: 'Click a stage to open it and complete it, from first idea to finished shots.' },
            { selector: 'div:has(> div > label > input[data-testid="film-import-json"])', title: 'Import and export', message: 'Click here to save your film as a file or load one you saved earlier.', optional: true },
        ],
    },
    {
        id: 'library', route: '/app/library', name: 'Library',
        steps: [
            { selector: testid('library-types'), title: 'Filter your work', message: 'Click a type to see only images, videos or audio.', optional: true },
            { selector: '#library-assets', title: 'Everything you made', message: 'Your finished creations appear here. Click one to open it.' },
            { selector: target('library.download'), title: 'Download', message: 'Click Download to save a copy to your device.', optional: true },
            { selector: testid('library-favourite'), title: 'Favourite', message: 'Click the star to keep your best work easy to find.', optional: true },
        ],
    },
    {
        id: 'projects', route: '/app/projects', name: 'Projects',
        steps: [
            { selector: testid('project-new'), title: 'Start a project', message: 'Click New project to group related work in one place.' },
            { selector: testid('project-search'), title: 'Find a project', message: 'Type here to search your projects.', optional: true },
        ],
    },
    {
        id: 'enhance', route: '/app/enhance', name: 'Enhance',
        steps: [
            { selector: 'label:has(input[data-testid="enhance-upload"])', title: 'Choose a video', message: 'Click to choose a video from your device. It stays on your device while you edit.' },
            { selector: target('enhance.adjustments'), title: 'Adjust it', message: 'Drag the sliders to change the look. The preview updates as you go.', optional: true },
            { selector: testid('enhance-export'), title: 'Export', message: 'Click Export to save the finished video.', optional: true },
        ],
    },
    {
        id: 'credits', route: '/app/credits', name: 'Credits',
        steps: [
            { selector: target('credits.subscriptions'), title: 'Monthly plans', message: 'Click a plan for credits every month at the best rate.', optional: true },
            { selector: target('credits.packs'), title: 'One-off packs', message: 'Click a pack to top up once. Pack credits do not expire.' },
            { selector: '#credit-statement-title', title: 'Your statement', message: 'Every credit you earn or spend is listed below this heading.', optional: true },
        ],
    },
    {
        id: 'account', route: '/app/account', name: 'Account',
        steps: [
            { selector: 'h1', title: 'Your account', message: 'Security, sign-in methods and your data live on this page.' },
            { selector: testid('account-password-heading'), title: 'Change your password', message: 'Click here to set a new password.', optional: true },
            { selector: testid('account-sign-out-others'), title: 'Sign out other devices', message: 'Click to end every other session if you think someone else has access.', optional: true },
        ],
    },
    {
        id: 'publish-calendar', route: '/app/publish/calendar', name: 'Publish calendar',
        steps: [{ selector: target('publish.calendar'), title: 'Your calendar', message: 'Scheduled posts appear by day. Click a post to review or reschedule it.' }],
    },
    {
        id: 'publish-analytics', route: '/app/publish/analytics', name: 'Publish analytics',
        steps: [{ selector: target('publish.analytics'), title: 'How your posts perform', message: 'Click a network or date range to see its results.' }],
    },
    {
        id: 'publish', route: '/app/publish', exact: true, name: 'Publish',
        steps: [
            { selector: target('publish.accounts'), title: 'Connect an account', message: 'Click Connect beside a network to link the account you post to.' },
            { selector: '#schedule', title: 'Create a post', message: 'Write your post, choose where it goes and when, then click Schedule.' },
        ],
    },
    {
        id: 'editor', route: '/app/editor', name: 'Editor',
        steps: [
            { selector: `${testid('editor-empty-add')}, ${testid('editor-import')}`, title: 'Add your media', message: 'Click to add video, images or audio to the timeline.' },
            { selector: testid('editor-tools'), title: 'Tools', message: 'Click a tool to cut, add text, captions and more.', optional: true },
            { selector: testid('editor-export'), title: 'Export', message: 'Click Export when you are done to render your video.', optional: true },
        ],
    },
    {
        id: 'faceless-reel', route: '/app/faceless-reel', name: 'Faceless Reel',
        steps: [
            { selector: 'main textarea', title: 'Describe your story', message: 'Click here and write the story or topic. Then choose a look and a delivery below it.' },
        ],
    },
    {
        id: 'video-agent', route: '/app/video-agent', name: 'Video agent',
        steps: [
            { selector: '#brief', title: 'Write a brief', message: 'Click here and describe the video you want.' },
            { selector: '#narration-text', title: 'Narration', message: 'Optionally write what the voice should say.', optional: true },
            { selector: testid('agent-approve'), title: 'You approve the cost', message: 'Review the plan and price, then click Approve. Nothing is spent before that.', optional: true },
        ],
    },
    {
        id: 'vibe', route: '/app/vibe', name: 'Vibe check',
        steps: [{ selector: 'main h1', title: 'A quick set of questions', message: 'Answer a few questions so Veyrnox can suggest the right starting points. It takes about a minute.' }],
    },
    {
        id: 'skills', route: '/app/skills', name: 'Skills',
        steps: [
            { selector: 'h1', title: 'Studio skills', message: 'Skills are ready-made jobs for Chat, such as writing scripts or shot lists.' },
            { selector: target('chat.skills'), title: 'Pick a skill', message: 'Click a skill to use it in Chat.', optional: true },
        ],
    },
    {
        id: 'features', route: '/app/features', name: 'Tools',
        steps: [
            { selector: 'h1', title: 'All the tools', message: 'Every Veyrnox tool is listed here. Click one to open it.' },
            { selector: testid('face-filters'), title: 'Filter the list', message: 'Click a filter to narrow the tools.', optional: true },
        ],
    },
]);

const GENERIC_STEP = Object.freeze({ selector: 'main h1, h1', title: 'This page', message: 'Use the controls on this page. The navigation bar takes you back to every other area.' });
const EXCLUDED = ['/app/admin'];

function normalise(pathname) {
    if (typeof pathname !== 'string') return '';
    const path = pathname.split(/[?#]/)[0].replace(/\/+$/, '');
    return path || '/';
}

const inside = (path, route) => path === route || path.startsWith(`${route}/`);

// The longest matching route wins, so /app/publish/calendar is not the Publish tour.
export function tourForPath(pathname) {
    const path = normalise(pathname);
    if (!inside(path, '/app') || EXCLUDED.some((route) => inside(path, route))) return null;
    let best = null;
    for (const tour of FEATURE_TOURS) {
        if (tour.exact ? path !== tour.route : !inside(path, tour.route)) continue;
        if (!best || tour.route.length > best.route.length) best = tour;
    }
    if (best) return best;
    const [, , first, second] = path.split('/');
    const key = second ? `${first}/${second}` : first;
    return { id: `page:${key}`, route: path, name: first, generic: true, steps: [GENERIC_STEP] };
}

export function seenKey(userId) {
    return `${TOUR_STORAGE_PREFIX}${userId}`;
}

export function parseSeen(raw) {
    try {
        const value = JSON.parse(raw);
        return Array.isArray(value) ? value.filter((id) => typeof id === 'string' && id.length <= 80) : [];
    } catch { return []; }
}

export function addSeen(seen, id) {
    return seen.includes(id) ? seen : [...seen, id].slice(-80);
}

// First element matching any selector that is actually visible, or null.
export function findVisible(doc, selector) {
    let list;
    try { list = doc.querySelectorAll(selector); } catch { return null; }
    for (const element of list) {
        const box = element.getBoundingClientRect();
        if (element.getClientRects().length && box.width > 0 && box.height > 0) return element;
    }
    return null;
}
