// The grouped menu (Agents / Tools / Assets / Inspire), the same shape as the web app's left sidebar. Every href is an
// existing route; the drawer only navigates, it owns no screens.
export type MenuItem = { key: string; label: string; href: string };
export type MenuSection = { id: 'agents' | 'tools' | 'assets' | 'inspire'; label: string; items: MenuItem[] };

export const MENU_SECTIONS: MenuSection[] = [
    {
        id: 'agents',
        label: 'menu.agents',
        items: [
            { key: 'chat', label: 'menu.chat', href: '/chat' },
            { key: 'videoAgent', label: 'menu.videoAgent', href: '/create/agent' },
        ],
    },
    {
        id: 'tools',
        label: 'menu.tools',
        items: [
            { key: 'create', label: 'menu.create', href: '/create' },
            { key: 'film', label: 'menu.film', href: '/film' },
            { key: 'oddlings', label: 'menu.oddlings', href: '/oddlings' },
            { key: 'publish', label: 'menu.publish', href: '/publish' },
        ],
    },
    {
        id: 'assets',
        label: 'menu.assets',
        items: [
            { key: 'library', label: 'menu.library', href: '/library' },
            { key: 'projects', label: 'menu.projects', href: '/projects' },
            { key: 'brandKit', label: 'menu.brandKit', href: '/brand-kit' },
            { key: 'credits', label: 'menu.credits', href: '/credits' },
        ],
    },
    {
        id: 'inspire',
        label: 'menu.inspire',
        items: [
            { key: 'templates', label: 'menu.templates', href: '/create/presets' },
            { key: 'models', label: 'menu.models', href: '/models' },
            { key: 'cinema', label: 'menu.cinema', href: '/cinema' },
            { key: 'help', label: 'menu.help', href: '/help' },
        ],
    },
];
