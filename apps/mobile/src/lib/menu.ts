// The drawer, in the web sidebar's groups and order (app/veyrnox/_lib/studioNavigation.js): Home, then Tools (Create,
// Video editor, Publish, Social Cinema), then Assets (Library, Brand kit, Credits, LLM Chat), and Help at the foot like
// the web's "?" button. The drawer repeats the bottom tabs on purpose, so the two apps list the same destinations.
// Audio is the one web destination with no phone screen yet, so it is not listed. Every href is an existing route; the
// drawer only navigates, it owns no screens.
import type { MenuIcon } from './menuIcons';

export type MenuItem = { key: string; label: string; href: string; icon: MenuIcon; hint?: string };
export type MenuSection = { id: 'agents' | 'tools' | 'assets' | 'inspire'; label: string; items: MenuItem[] };

export const HOME_ICON: MenuIcon = 'house';

export const MENU_SECTIONS: MenuSection[] = [
    {
        id: 'tools',
        label: 'menu.tools',
        items: [
            { key: 'create', label: 'menu.create', href: '/create', icon: 'image' },
            { key: 'editor', label: 'menu.videoEditor', href: '/editor', icon: 'video' },
            { key: 'publish', label: 'menu.publish', href: '/publish', icon: 'send' },
            { key: 'cinema', label: 'menu.cinema', href: '/cinema', icon: 'slate' },
        ],
    },
    {
        id: 'assets',
        label: 'menu.assets',
        items: [
            { key: 'library', label: 'menu.library', href: '/library', icon: 'play' },
            { key: 'brandKit', label: 'menu.brandKit', href: '/brand-kit', icon: 'palette' },
            { key: 'credits', label: 'menu.credits', href: '/credits', icon: 'coins' },
            { key: 'chat', label: 'menu.chat', href: '/chat', icon: 'chat' },
        ],
    },
];

// Below the groups, as the web sidebar keeps Help at its foot.
export const MENU_FOOTER: MenuItem[] = [{ key: 'help', label: 'menu.help', href: '/help', icon: 'help' }];

// The item whose screen you are on: the longest menu href that is the current path or a parent of it, so a nested screen
// lights its own section. Home is lit only on the home screen.
export function activeItemKey(pathname: string): string | null {
    if (pathname === '/' || pathname === '') return 'home';
    let best: { key: string; length: number } | null = null;
    for (const item of [...MENU_SECTIONS.flatMap((s) => s.items), ...MENU_FOOTER]) {
        if ((pathname === item.href || pathname.startsWith(`${item.href}/`)) && (!best || item.href.length > best.length)) best = { key: item.key, length: item.href.length };
    }
    return best?.key ?? null;
}
