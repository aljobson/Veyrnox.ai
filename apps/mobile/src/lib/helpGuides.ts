import { HELP_GUIDES } from './helpGuidesData';

type Guide = typeof HELP_GUIDES[number];
type Say = (key: string) => string;

// Keys identify the web steps, not their position at render time. Drift checks cover source changes;
// presentation tests separately protect the phone's purchase and local-storage instructions.
const MOBILE_COPY: Readonly<Record<string, string>> = {
    'helpGuides.content.credits.s3.body': 'helpGuides.mobile.credits.buying',
    'helpGuides.content.library.s3.body': 'helpGuides.mobile.library.favourites',
    'helpGuides.content.first-generation.s2.body': 'helpGuides.mobile.firstGeneration.model',
};

export function guideById(id: string | undefined): Guide | null {
    return HELP_GUIDES.find(guide => guide.id === id) ?? null;
}

export function presentGuide(guide: Guide, say: Say) {
    return {
        id: guide.id,
        title: say(guide.title),
        summary: say(guide.summary),
        steps: guide.steps.map(step => ({ title: say(step.title), body: say(MOBILE_COPY[step.body] ?? step.body) })),
        links: guide.links.filter(link => guideDestination(link.href) !== null).map(link => ({ label: say(link.label), href: link.href })),
    };
}

const NATIVE_ROUTES = {
    '/legal/terms': '/legal/terms',
    '/legal/privacy': '/legal/privacy',
    '/legal/aup': '/legal/aup',
    '/legal/refund': '/legal/refund',
    '/legal/cinema-content': '/legal/cinema-content',
    '/legal/gdpr': '/legal/gdpr',
    '/app/create': '/create',
    '/pricing': '/pricing',
    '/presets': '/create/presets',
    '/tools': '/create/tools',
    '/app/library': '/library',
    '/app/credits': '/credits',
} as const;

type NativeRoute = typeof NATIVE_ROUTES[keyof typeof NATIVE_ROUTES];
export function guideDestination(href: string): { kind: 'native'; href: NativeRoute } | null {
    const route = (NATIVE_ROUTES as Readonly<Record<string, NativeRoute | undefined>>)[href];
    if (route) return { kind: 'native', href: route };
    return null;
}
