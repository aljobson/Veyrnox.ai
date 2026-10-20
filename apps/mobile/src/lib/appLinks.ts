// Universal Links (iOS) and App Links (Android), ADR-0106. The server publishes the
// association files for these web paths (lib/mobileAppLinks.js, APP_LINK_PATHS); this
// maps each one to the app screen that exists for it. Keep the two lists in step.

const WEB_HOSTS = new Set(['veyrnox.ai', 'www.veyrnox.ai']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A catalog model id: letters, digits, dot, dash and underscore only.
const MODEL_ID_RE = /^[A-Za-z0-9._-]{1,80}$/;

const AUTHORIZATION_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;

// The sections under /app on the website that have a screen in the app.
const SECTIONS: Record<string, string> = {
    library: '/library',
    chat: '/chat',
    create: '/create',
    credits: '/credits',
    account: '/account',
    publish: '/publish',
};

function opened(segments: string[]): string {
    const [section, id] = segments;
    const root = section ? SECTIONS[section] : undefined;
    if (!root) return '/';
    if (id === undefined) return root;
    // A library item opens as a creation, a chat as that thread, a model as its create form.
    if (section === 'library' && UUID_RE.test(id)) return `/job/${id}`;
    if (section === 'chat' && UUID_RE.test(id)) return `/chat/${id}`;
    if (section === 'create' && MODEL_ID_RE.test(id)) return `/create/${id}`;
    return root;
}

// Maps an incoming link to an app route. Anything that is not a veyrnox.ai web link
// under /app (the app's own scheme, an in-app path) is returned unchanged.
export function mapAppLink(path: string): string {
    let url: URL;
    try {
        url = new URL(path);
    } catch {
        return path;
    }
    if (url.protocol !== 'https:' || !WEB_HOSTS.has(url.hostname)) return path;
    const segments = url.pathname.split('/').filter(Boolean);
    // A shared Cinema title or episode: /social-cinema/title/<id> and /social-cinema/watch/<id> (ADR-0164).
    if (segments[0] === 'social-cinema' && segments.length === 3 && UUID_RE.test(segments[2])) {
        if (segments[1] === 'title') return `/cinema/${segments[2].toLowerCase()}`;
        if (segments[1] === 'watch') return `/cinema/watch/${segments[2].toLowerCase()}`;
    }
    // An assistant's connection request (the web's consent page); the id is Supabase's, so it is checked, not trusted.
    if (segments[0] === 'oauth' && segments[1] === 'consent' && segments.length === 2) {
        const id = url.searchParams.get('authorization_id');
        return id && AUTHORIZATION_ID_RE.test(id) ? `/oauth-consent?authorization_id=${encodeURIComponent(id)}` : '/';
    }
    if (segments[0] !== 'app') return '/';
    return opened(segments.slice(1));
}
