import type { MenuIcon } from './menuIcons';
import { FILM_STUDIO_ENABLED } from './filmStudioSwitch';

export type FeatureAvailability = 'always' | 'film-build' | 'music-live';
export type FeatureStatus = 'native' | 'gap' | 'system' | 'unavailable' | 'build-time' | 'capability';
export type FeatureMenuSection = 'tools' | 'assets' | 'footer';
export type AudioFeatureGroup = 'studios' | 'performance';
export type FeatureEntryPoint = 'create' | 'publish';

export interface MobileFeatureDefinition {
    readonly id: string;
    readonly titleKey: string;
    readonly href: string;
    readonly icon?: MenuIcon;
    readonly keywords?: string;
    readonly availability?: FeatureAvailability;
    readonly menu?: { readonly section: FeatureMenuSection; readonly order: number; readonly labelKey?: string; readonly hintKey?: string };
    readonly audio?: { readonly group: AudioFeatureGroup; readonly order: number };
    readonly entryPoint?: FeatureEntryPoint;
    readonly discoveryOwner?: 'audio' | 'tools';
    readonly webRoutes?: readonly string[];
    readonly status?: FeatureStatus;
    readonly gapReason?: string;
}

export interface FeatureAvailabilityFlags {
    readonly filmStudio: boolean;
    readonly musicAvailable: boolean;
}

// One native catalogue for routes that appear in global search, navigation, Audio, first-goal hand-offs, or the
// web-to-phone parity contract. Domain catalogues such as CREATIVE_FEATURES remain separate, then join search as one
// registered family. Exact web paths matter: studioNavigation has duplicate keys and rows with no key at all.
const MOBILE_FEATURE_DEFINITIONS = [
    { id: 'explore', titleKey: 'srch.s.explore', href: '/', icon: 'house', keywords: 'home templates start', webRoutes: ['/app'] },
    { id: 'create', titleKey: 'srch.s.create', href: '/create', icon: 'image', keywords: 'generate image video audio make', menu: { section: 'tools', order: 0, labelKey: 'menu.create' }, webRoutes: ['/app/create'] },
    { id: 'tools', titleKey: 'srch.s.tools', href: '/create/tools', icon: 'wrench', keywords: 'upscale remove background edit photo video', webRoutes: ['/tools'] },
    { id: 'audio', titleKey: 'menu.audio', href: '/audio', icon: 'headphones', keywords: 'music speech dialogue voice sound audio', menu: { section: 'tools', order: 1, labelKey: 'menu.audio' }, webRoutes: ['/app/audio'] },
    { id: 'smartCut', titleKey: 'menu.smartCut', href: '/smart-cut', icon: 'sparkle', keywords: 'smart cut speech silence remove ums best cut', menu: { section: 'tools', order: 2, labelKey: 'menu.smartCut', hintKey: 'menu.smartCutHint' }, webRoutes: ['/app/library#smart-cut'] },
    { id: 'editor', titleKey: 'editor.title', href: '/editor', icon: 'scissors', keywords: 'studio professional editor edit trim join captions clip timeline cut projects', menu: { section: 'tools', order: 3, labelKey: 'editor.title' }, webRoutes: ['/app/editor'] },
    { id: 'photoStudio', titleKey: 'liveEdit.title', href: '/live-edit', icon: 'magicWand', keywords: 'photo studio retouch makeup hair filters live edit', webRoutes: ['/app/photo-studio'] },
    { id: 'editorReview', titleKey: 'preview.title', href: '/editor', webRoutes: ['/app/editor/review'], status: 'gap', gapReason: 'Native saved-version review is not implemented; Studio is the safe fallback.' },
    { id: 'publish', titleKey: 'srch.s.publish', href: '/publish', icon: 'send', keywords: 'post schedule social calendar', menu: { section: 'tools', order: 4, labelKey: 'menu.publish' }, webRoutes: ['/app/publish', '/publish'] },
    { id: 'publishPlan', titleKey: 'plan.navTitle', href: '/publish', webRoutes: ['/app/publish/plan'], status: 'gap', gapReason: 'Native plan status and safe period-end cancellation are scheduled for Wave 2; Publish is the safe fallback.' },
    { id: 'cinema', titleKey: 'srch.s.cinema', href: '/cinema', icon: 'slate', keywords: 'watch films vote community', menu: { section: 'tools', order: 5, labelKey: 'menu.cinema' }, webRoutes: ['/social-cinema', '/social-cinema/creator', '/social-cinema/pass', '/social-cinema/series/[slug]', '/social-cinema/title/[id]', '/social-cinema/watch/[id]'] },
    { id: 'library', titleKey: 'srch.s.library', href: '/library', icon: 'play', keywords: 'creations files downloads saved', menu: { section: 'assets', order: 0, labelKey: 'menu.library' }, webRoutes: ['/app/library'] },
    { id: 'brandKit', titleKey: 'srch.s.brand', href: '/brand-kit', icon: 'palette', keywords: 'brand colours colors fonts palette', menu: { section: 'assets', order: 1, labelKey: 'menu.brandKit' }, webRoutes: ['/app/brand-kit'] },
    { id: 'credits', titleKey: 'srch.s.credits', href: '/credits', icon: 'coins', keywords: 'balance buy top up packs', menu: { section: 'assets', order: 2, labelKey: 'menu.credits' }, webRoutes: ['/app/credits'] },
    { id: 'chat', titleKey: 'menu.chat', href: '/chat', icon: 'chat', keywords: 'assistant talk ai personas', menu: { section: 'assets', order: 3, labelKey: 'menu.chat' }, webRoutes: ['/app/chat'] },
    { id: 'help', titleKey: 'srch.s.help', href: '/help', icon: 'help', keywords: 'support contact question', menu: { section: 'footer', order: 0, labelKey: 'menu.help' } },

    { id: 'film', titleKey: 'srch.s.film', href: '/film', icon: 'film', keywords: 'film studio shots script references assets prompts movie', availability: 'film-build', webRoutes: ['/app/film-studio'] },
    { id: 'mcp', titleKey: 'srch.s.mcp', href: '/mcp', icon: 'cpu', keywords: 'connector assistant oauth endpoint integrations', webRoutes: ['/mcp'] },
    { id: 'oddlings', titleKey: 'srch.s.oddlings', href: '/oddlings', icon: 'smiley', keywords: 'characters creator mascot animate', webRoutes: ['/app/oddlings', '/oddlings', '/oddlings/[id]'] },
    { id: 'templates', titleKey: 'srch.s.templates', href: '/create/presets', icon: 'squares', keywords: 'presets gallery', webRoutes: ['/app/templates', '/presets', '/presets/[id]'] },
    { id: 'projects', titleKey: 'srch.s.projects', href: '/projects', icon: 'folder', keywords: 'projects edit saved', webRoutes: ['/app/projects', '/app/projects/[id]'] },
    { id: 'models', titleKey: 'srch.s.models', href: '/models', icon: 'cube', keywords: 'catalogue catalog list compare', webRoutes: ['/models', '/models/[id]', '/compare/[pair]'] },
    { id: 'guides', titleKey: 'helpGuides.all', href: '/guides', icon: 'help', keywords: 'guides tutorials learn', webRoutes: ['/guides', '/guides/[id]'] },
    { id: 'skills', titleKey: 'chat.skills.title', href: '/chat/skills', icon: 'sparkle', keywords: 'studio skills assistant workflows', webRoutes: ['/app/skills'] },
    { id: 'agent', titleKey: 'videoAgent.title', href: '/create/agent', icon: 'brain', keywords: 'video agent assistant', webRoutes: ['/app/video-agent'] },
    { id: 'features', titleKey: 'menu.features', href: '/features', icon: 'magicWand', keywords: 'guided creative workflows', discoveryOwner: 'tools', status: 'system', gapReason: 'Compatibility and contextual reuse route; ordinary discovery belongs to Tools.', webRoutes: ['/app/features', '/app/features/[slug]'] },
    { id: 'facelessReel', titleKey: 'facelessReel.chip', href: '/faceless-reel', icon: 'filmReel', keywords: 'faceless reel video', webRoutes: ['/app/faceless-reel'] },
    { id: 'vibe', titleKey: 'vibe.intro.title', href: '/vibe', icon: 'swatches', keywords: 'vibe taste preferences', webRoutes: ['/app/vibe'] },

    { id: 'yourMusic', titleKey: 'music.title', href: '/music', icon: 'vinylRecord', keywords: 'songs music library history hooks', availability: 'music-live', webRoutes: ['/app/music', '/app/music/library', '/app/music/songs/[id]'] },
    { id: 'music', titleKey: 'audioHub.music.title', href: '/music/create', icon: 'audio', keywords: 'make generate song music', availability: 'music-live', audio: { group: 'studios', order: 0 }, webRoutes: ['/app/music/create'] },
    { id: 'speech', titleKey: 'audioHub.speech.title', href: '/speech', icon: 'microphone', keywords: 'text to speech voice', audio: { group: 'studios', order: 1 }, webRoutes: ['/app/text-to-speech'] },
    { id: 'dialogue', titleKey: 'audioHub.dialogue.title', href: '/dialogue', icon: 'chatsCircle', keywords: 'dialogue speakers conversation', audio: { group: 'studios', order: 2 }, webRoutes: ['/app/dialogue'] },
    { id: 'beats', titleKey: 'beat.title', href: '/beats', icon: 'waveform', keywords: 'music editor ai audio stems instruments mixer arrangement', webRoutes: ['/app/music/beats', '/app/music/beats/new', '/app/music/beats/[id]', '/app/music/studio', '/app/music/studio/[id]', '/app/music/sounds'] },
    { id: 'instruments', titleKey: 'instruments.title', href: '/instruments', icon: 'pianoKeys', keywords: 'play instruments takes', webRoutes: ['/app/music/instruments'] },
    { id: 'musicDiscover', titleKey: 'musicDiscover.title', href: '/music/discover', icon: 'compass', keywords: 'music discover labs best rank', availability: 'music-live', webRoutes: ['/app/music/discover', '/app/music/labs', '/music', '/music/tracks/[slug]', '/music/creators/[handle]'] },
    { id: 'musicPlaylists', titleKey: 'musicPlaylists.title', href: '/music/playlists', icon: 'playlist', keywords: 'music playlists', availability: 'music-live', webRoutes: ['/app/music/playlists'] },
    { id: 'musicAlbums', titleKey: 'musicAlbums.title', href: '/music/albums', icon: 'vinylRecord', keywords: 'music albums releases ep singles', availability: 'music-live', webRoutes: ['/app/music/albums', '/music/albums/[slug]'] },
    { id: 'musicWorkspaces', titleKey: 'music.title', href: '/music', icon: 'usersThree', availability: 'music-live', webRoutes: ['/app/music/workspaces'], status: 'gap', gapReason: 'Native collaborative Music workspaces are not implemented yet.' },
    { id: 'lipSync', titleKey: 'audioHub.lipSync.title', href: '/features/lip-sync', icon: 'waveform', keywords: 'lip sync mouth voice', discoveryOwner: 'tools', audio: { group: 'performance', order: 0 }, webRoutes: ['/app/lip-sync'] },
    { id: 'dubbing', titleKey: 'audioHub.dubbing.title', href: '/features/video-dubbing', icon: 'monitorPlay', keywords: 'video dubbing translate performance', discoveryOwner: 'tools', audio: { group: 'performance', order: 1 }, webRoutes: ['/app/performance'] },
    { id: 'talkingPhoto', titleKey: 'audioHub.talkingPhoto.title', href: '/features/ai-talking-photo-generator', icon: 'userSound', keywords: 'talking photo portrait', discoveryOwner: 'tools', audio: { group: 'performance', order: 2 } },
    { id: 'singingPhoto', titleKey: 'audioHub.singingPhoto.title', href: '/features/singing-photo', icon: 'pianoKeys', keywords: 'singing photo portrait', discoveryOwner: 'tools', audio: { group: 'performance', order: 3 } },

    { id: 'publishActivity', titleKey: 'activity.title', href: '/publish/activity', entryPoint: 'publish', webRoutes: ['/app/publish/activity'] },
    { id: 'publishAds', titleKey: 'ads.title', href: '/publish/ads', entryPoint: 'publish', webRoutes: ['/app/publish/ads'] },
    { id: 'publishAnalytics', titleKey: 'analytics.title', href: '/publish/analytics', entryPoint: 'publish', webRoutes: ['/app/publish/analytics'] },
    { id: 'publishAutolists', titleKey: 'autolists.title', href: '/publish/autolists', entryPoint: 'publish', webRoutes: ['/app/publish/autolists'] },
    { id: 'publishCalendar', titleKey: 'calendar.title', href: '/publish/calendar', entryPoint: 'publish', webRoutes: ['/app/publish/calendar'] },
    { id: 'publishCommerce', titleKey: 'commerce.title', href: '/publish/commerce', entryPoint: 'publish', webRoutes: ['/app/publish/commerce'] },
    { id: 'publishContacts', titleKey: 'contacts.title', href: '/publish/contacts', entryPoint: 'publish', webRoutes: ['/app/publish/contacts'] },
    { id: 'publishDeveloper', titleKey: 'dev.row', href: '/publish/developer', entryPoint: 'publish', webRoutes: ['/app/publish/developer', '/developers'] },
    { id: 'publishInbox', titleKey: 'inbox.title', href: '/publish/inbox', entryPoint: 'publish', webRoutes: ['/app/publish/inbox'] },
    { id: 'publishQueues', titleKey: 'queues.title', href: '/publish/queues', entryPoint: 'publish', webRoutes: ['/app/publish/queues'] },
    { id: 'publishReports', titleKey: 'reports.title', href: '/publish/reports', entryPoint: 'publish', webRoutes: ['/app/publish/reports'] },
    { id: 'publishSmartlink', titleKey: 'smartlink.title', href: '/publish/smartlink', entryPoint: 'publish', webRoutes: ['/app/publish/smartlink'] },
    { id: 'publishTeam', titleKey: 'team.title', href: '/publish/team', entryPoint: 'publish', webRoutes: ['/app/publish/team'] },
    { id: 'publishWorkflows', titleKey: 'publishWorkflows.title', href: '/publish/workflows', entryPoint: 'publish', webRoutes: ['/app/publish/workflows'] },

    { id: 'account', titleKey: 'srch.s.account', href: '/account', keywords: 'profile email settings', webRoutes: ['/app/account'] },
    { id: 'appeals', titleKey: 'srch.s.appeals', href: '/appeals', keywords: 'content decisions', webRoutes: ['/app/account/appeals'] },
    { id: 'report', titleKey: 'srch.s.report', href: '/report', keywords: 'problem abuse flag', webRoutes: ['/app/account/report'] },
    { id: 'wins', titleKey: 'wins.title', href: '/wins', keywords: 'wins progress achievements', webRoutes: ['/app/account/wins'] },
    { id: 'history', titleKey: 'srch.s.history', href: '/history', keywords: 'ledger charges refunds' },
    { id: 'referrals', titleKey: 'srch.s.referrals', href: '/referrals', keywords: 'invite friends code' },
    { id: 'pricing', titleKey: 'srch.s.pricing', href: '/pricing', keywords: 'cost price credits', webRoutes: ['/pricing'] },
    { id: 'security', titleKey: 'srch.s.security', href: '/security', keywords: 'password two-factor 2fa devices assistants sessions' },
    { id: 'blocked', titleKey: 'srch.s.blocked', href: '/blocked', keywords: 'mute members' },
    { id: 'about', titleKey: 'srch.s.about', href: '/about', keywords: 'company legal terms privacy', webRoutes: ['/about'] },
] as const satisfies readonly MobileFeatureDefinition[];

export type MobileFeatureId = (typeof MOBILE_FEATURE_DEFINITIONS)[number]['id'];

// Consumers need the common optional fields, while ids stay a closed union for route hand-offs.
// Keeping the literal definitions private avoids leaking a 63-member structural union where
// TypeScript treats an omitted optional field as a property that cannot be read at all.
export const MOBILE_FEATURES: readonly (MobileFeatureDefinition & { readonly id: MobileFeatureId })[] = MOBILE_FEATURE_DEFINITIONS;

const byId = new Map<string, MobileFeatureDefinition>(MOBILE_FEATURES.map((feature) => [feature.id, feature]));

export function mobileFeature(id: MobileFeatureId): MobileFeatureDefinition {
    const feature = byId.get(id);
    if (!feature) throw new Error(`unknown mobile feature: ${id}`);
    return feature;
}

export function featureHref(id: MobileFeatureId): string {
    return mobileFeature(id).href;
}

export function featureAvailable(feature: MobileFeatureDefinition, flags: FeatureAvailabilityFlags): boolean {
    if (feature.availability === 'film-build') return flags.filmStudio;
    if (feature.availability === 'music-live') return flags.musicAvailable;
    return true;
}

export function menuFeatures(section: FeatureMenuSection): MobileFeatureDefinition[] {
    return MOBILE_FEATURES.filter((feature) => feature.menu?.section === section).sort((a, b) => (a.menu?.order ?? 0) - (b.menu?.order ?? 0));
}

export function audioFeatureIds(group: AudioFeatureGroup): string[] {
    return MOBILE_FEATURES.filter((feature) => feature.audio?.group === group).sort((a, b) => (a.audio?.order ?? 0) - (b.audio?.order ?? 0)).map((feature) => feature.id);
}

export function searchableFeatures(flags: FeatureAvailabilityFlags): MobileFeatureDefinition[] {
    return MOBILE_FEATURES.filter((feature) => feature.keywords && !feature.discoveryOwner && featureAvailable(feature, flags));
}

// The native All Features directory is intentionally broader than the drawer. It is the discoverability backstop
// for production-supported screens, while gaps and system-only flows remain documented in the parity disposition.
export function directoryFeatures(flags: FeatureAvailabilityFlags): MobileFeatureDefinition[] {
    return searchableFeatures(flags).filter((feature) => feature.id !== 'features' && feature.status !== 'gap' && feature.status !== 'system' && feature.status !== 'unavailable');
}

export interface WebRouteDisposition {
    readonly webHref: string;
    readonly featureId: MobileFeatureId;
    readonly mobileHref: string;
    readonly status: FeatureStatus;
    readonly reason?: string;
}

export interface WebInventoryExclusion {
    readonly webHref: string;
    readonly reason: string;
}

// Exact, reviewed exclusions keep additions outside /app from silently bypassing the parity contract.
export const WEB_INVENTORY_EXCLUSIONS: readonly WebInventoryExclusion[] = [
    { webHref: '/', reason: 'Public marketing landing page, not a signed-in product destination.' },
    { webHref: '/auth/callback', reason: 'Authentication callback handled by the provider/system flow.' },
    { webHref: '/legal/aup', reason: 'Public legal document.' },
    { webHref: '/legal/cinema-content', reason: 'Public legal document.' },
    { webHref: '/legal/gdpr', reason: 'Public legal document.' },
    { webHref: '/legal/privacy', reason: 'Public legal document.' },
    { webHref: '/legal/refund', reason: 'Public legal document.' },
    { webHref: '/legal/terms', reason: 'Public legal document.' },
    { webHref: '/s/[slug]', reason: 'Public short-link recipient flow.' },
    { webHref: '/social/connect/callback/[network]', reason: 'Provider callback handled by the system browser.' },
    { webHref: '/social/review/[token]', reason: 'Token-entry public review flow, not a signed-in destination.' },
    { webHref: '/social/team/invite/[token]', reason: 'Token-entry invitation flow, not a signed-in destination.' },
    { webHref: '/design-system', reason: 'Internal design-system reference.' },
    { webHref: '/editors', reason: 'Public marketing overview of the Video Editor, Audio Editor and Smart Cut. It only links into signed-in screens that already have native routes (Library, Music, Smart Cut).' },
    { webHref: '/listen/[token]', reason: 'Public token audio player.' },
    { webHref: '/oauth/consent', reason: 'OAuth authorization hand-off remains a system web flow.' },
    { webHref: '/m', reason: 'Legacy mobile web client superseded by the native app.' },
    { webHref: '/m/create', reason: 'Legacy mobile web client superseded by the native app.' },
    { webHref: '/m/credits', reason: 'Legacy mobile web client superseded by the native app.' },
    { webHref: '/m/explore', reason: 'Legacy mobile web client superseded by the native app.' },
    { webHref: '/m/job', reason: 'Legacy mobile web client superseded by the native app.' },
    { webHref: '/m/library', reason: 'Legacy mobile web client superseded by the native app.' },
    ...[
        '/app/admin', '/app/admin/affiliates', '/app/admin/appeals', '/app/admin/changes', '/app/admin/cinema',
        '/app/admin/cinema/comments', '/app/admin/cinema/rankings', '/app/admin/cinema/story-polls',
        '/app/admin/cinema/submissions', '/app/admin/cinema/voting', '/app/admin/endpoints',
        '/app/admin/music-comments', '/app/admin/payments', '/app/admin/plans', '/app/admin/reports',
        '/app/admin/roles', '/app/admin/security', '/app/admin/support', '/app/admin/switches',
        '/app/admin/traffic', '/app/admin/users', '/app/admin/violations', '/app/admin/webhooks',
    ].map((webHref) => ({ webHref, reason: 'Internal administrator-only route.' })),
];

function dispositionStatus(feature: MobileFeatureDefinition): FeatureStatus {
    if (feature.status) return feature.status;
    if (feature.availability === 'film-build') return FILM_STUDIO_ENABLED ? 'native' : 'build-time';
    if (feature.availability === 'music-live') return 'capability';
    return 'native';
}

function dispositionReason(feature: MobileFeatureDefinition, status: FeatureStatus): string | undefined {
    if (feature.gapReason) return feature.gapReason;
    if (status === 'build-time') return 'Controlled by the matching web/mobile Film Studio build switch.';
    if (status === 'capability') return 'Requires the named live Music capability.';
    return undefined;
}

export const WEB_ROUTE_DISPOSITIONS: readonly WebRouteDisposition[] = MOBILE_FEATURES.flatMap((feature) =>
    (feature.webRoutes ?? []).map((webHref) => {
        const status = dispositionStatus(feature);
        const reason = dispositionReason(feature, status);
        return { webHref, featureId: feature.id, mobileHref: feature.href, status, ...(reason ? { reason } : {}) };
    }),
);
