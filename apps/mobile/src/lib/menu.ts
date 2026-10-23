// The grouped menu (Agents / Tools / Assets / Inspire), the same shape as the web app's left sidebar. Every href is an
// existing route; the drawer only navigates, it owns no screens.
import type { MenuIcon } from './menuIcons';

export type MenuItem = { key: string; label: string; href: string; icon: MenuIcon };
export type MenuSection = { id: 'agents' | 'tools' | 'assets' | 'inspire'; label: string; items: MenuItem[] };

export const HOME_ICON: MenuIcon = 'house';

export const MENU_SECTIONS: MenuSection[] = [
    {
        id: 'agents',
        label: 'menu.agents',
        items: [
            { key: 'chat', label: 'menu.chat', href: '/chat', icon: 'chat' },
            { key: 'skills', label: 'chat.skills.title', href: '/chat/skills', icon: 'sparkle' },
            { key: 'videoAgent', label: 'menu.videoAgent', href: '/create/agent', icon: 'sparkle' },
        ],
    },
    {
        id: 'tools',
        label: 'menu.tools',
        items: [
            { key: 'create', label: 'menu.create', href: '/create', icon: 'image' },
            { key: 'tools', label: 'menu.toolDirectory', href: '/create/tools', icon: 'wrench' },
            { key: 'faceFilters', label: 'faceFilters.title', href: '/face-filters', icon: 'smiley' },
            { key: 'editor', label: 'tabs.editor', href: '/editor', icon: 'slate' },
            { key: 'quickEdit', label: 'edit.title', href: '/edit', icon: 'film' },
            { key: 'film', label: 'menu.film', href: '/film', icon: 'film' },
            { key: 'oddlings', label: 'menu.oddlings', href: '/oddlings', icon: 'user' },
            { key: 'mcp', label: 'menu.mcp', href: '/mcp', icon: 'wrench' },
            { key: 'publish', label: 'menu.publish', href: '/publish', icon: 'send' },
        ],
    },
    {
        id: 'assets',
        label: 'menu.assets',
        items: [
            { key: 'library', label: 'menu.library', href: '/library', icon: 'play' },
            { key: 'projects', label: 'menu.projects', href: '/projects', icon: 'folder' },
            { key: 'brandKit', label: 'menu.brandKit', href: '/brand-kit', icon: 'palette' },
            { key: 'credits', label: 'menu.credits', href: '/credits', icon: 'coins' },
        ],
    },
    {
        id: 'inspire',
        label: 'menu.inspire',
        items: [
            { key: 'templates', label: 'menu.templates', href: '/create/presets', icon: 'squares' },
            { key: 'models', label: 'menu.models', href: '/models', icon: 'cube' },
            { key: 'cinema', label: 'menu.cinema', href: '/cinema', icon: 'slate' },
            { key: 'help', label: 'menu.help', href: '/help', icon: 'help' },
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
