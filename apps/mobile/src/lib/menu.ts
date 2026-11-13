// The drawer. The bottom tabs carry the pillars (Create, Editor, Library, Publish), so the drawer holds only what the
// tabs do not: Cinema, the Vey chat, Help and Credits. Every other screen (Skills, Video agent, Features, Film,
// Oddlings, MCP, Projects, Brand kit, Templates, Models) keeps its route for deep links and in-screen links, and is
// simply not listed. Every href is an existing route; the drawer only navigates, it owns no screens.
import type { MenuIcon } from './menuIcons';

export type MenuItem = { key: string; label: string; href: string; icon: MenuIcon; hint?: string };
export type MenuSection = { id: 'tools' | 'assets'; label: string; items: MenuItem[] };

// Destinations the bottom tab bar already carries; the drawer does not list them again.
export const TAB_KEYS: ReadonlySet<string> = new Set(['create', 'editor', 'library', 'publish']);

export const HOME_ICON: MenuIcon = 'house';

export const MENU_SECTIONS: MenuSection[] = [
    {
        id: 'tools',
        label: 'menu.tools',
        items: [
            { key: 'cinema', label: 'menu.cinema', href: '/cinema', icon: 'slate' },
            { key: 'chat', label: 'menu.chat', href: '/chat', icon: 'chat' },
            { key: 'help', label: 'menu.help', href: '/help', icon: 'help' },
        ],
    },
    {
        id: 'assets',
        label: 'menu.assets',
        items: [
            { key: 'credits', label: 'menu.credits', href: '/credits', icon: 'coins' },
        ],
    },
];

// The item whose screen you are on: the longest menu href that is the current path or a parent of it, so Create is not
// lit while you are in the Video agent. Home is lit only on the home screen.
export function activeItemKey(pathname: string): string | null {
    if (pathname === '/' || pathname === '') return 'home';
    let best: { key: string; length: number } | null = null;
    for (const item of MENU_SECTIONS.flatMap((s) => s.items)) {
        if ((pathname === item.href || pathname.startsWith(`${item.href}/`)) && (!best || item.href.length > best.length)) best = { key: item.key, length: item.href.length };
    }
    return best?.key ?? null;
}
