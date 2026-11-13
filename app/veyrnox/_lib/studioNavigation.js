export function activeStudioDestination(pathname, items) {
  const path = (pathname || '').replace(/^\/veyrnox/, '') || '/';
  if (path === '/app') return 'explore';
  return items
    .filter((item) => item.href !== '/app' && (path === item.href || path.startsWith(`${item.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0]?.key ?? null;
}

// One table for every signed-in destination. The sidebar, the compact menu and
// the active-route lookup all derive from it, so a destination is added, gated
// or renamed in one place. `labelKey` is a full i18n key, or `label.<English>`.
// `flag` names a feature switch; `menu: false` keeps a row out of the phone menu.
// `nav: false` keeps a row out of the sidebar AND the phone menu while its route
// stays live (deep links, the active-route lookup and search still work). The
// visible nav is the product pillars only: Create (image, video and audio
// models behind its goal chips), Music, Editor, Publish and Cinema, with
// Library, Credits and the Vey chat as the utility group.
export const STUDIO_DESTINATIONS = [
  { section: 'tools', key: 'create', href: '/app/create', labelKey: 'label.Create', icon: 'image' },
  { section: 'tools', key: 'music', href: '/app/music/create', labelKey: 'label.Music', icon: 'music' },
  { section: 'tools', key: 'editor', href: '/app/editor', labelKey: 'label.Video editor', icon: 'scissors', flag: 'editor' },
  { section: 'tools', key: 'publish', href: '/app/publish', labelKey: 'app.nav.publish', icon: 'send', flag: 'publish' },
  { section: 'tools', key: 'cinema', href: '/social-cinema', labelKey: 'label.Social Cinema', icon: 'film' },
  { section: 'assets', key: 'library', href: '/app/library', labelKey: 'label.Library', icon: 'library' },
  { section: 'assets', key: 'brandKit', href: '/app/brand-kit', labelKey: 'app.editor.rail.brand', icon: 'palette', flag: 'projects' },
  { section: 'assets', key: 'credits', href: '/app/credits', labelKey: 'label.Credits', icon: 'coins' },
  { section: 'assets', key: 'chat', href: '/app/chat', labelKey: 'label.LLM Chat', icon: 'chat' },
  // Hidden from the nav, routes unchanged.
  { section: 'tools', key: 'skills', href: '/app/skills', labelKey: 'label.Studio skills', icon: 'wand', menu: false, nav: false },
  { section: 'tools', key: 'agent', href: '/app/video-agent', labelKey: 'app.nav.videoAgent', hintKey: 'app.nav.videoAgentHint', icon: 'agent', nav: false },
  { section: 'tools', key: 'features', href: '/app/features', labelKey: 'label.Tools', icon: 'wand', nav: false },
  { section: 'tools', key: 'film', href: '/app/film-studio', labelKey: 'label.Film Studio', hintKey: 'app.nav.filmStudioHint', icon: 'film', nav: false },
  { section: 'tools', key: 'oddlings', href: '/app/oddlings', labelKey: 'label.Oddlings', icon: 'character', nav: false },
  { section: 'tools', key: 'enhance', href: '/app/enhance', labelKey: 'label.Enhance', icon: 'wand', flag: 'enhance', nav: false },
  { section: 'tools', href: '/mcp', labelKey: 'label.MCP', icon: 'plug', menu: false, nav: false },
  { section: 'assets', key: 'projects', href: '/app/projects', labelKey: 'label.Projects', icon: 'folder', flag: 'projects', nav: false },
  { section: 'assets', href: '/presets', labelKey: 'label.Templates', icon: 'template', menu: false, nav: false },
  { section: 'assets', href: '/models', labelKey: 'label.Models', icon: 'cube', menu: false, nav: false },
  { section: 'assets', href: '/guides', labelKey: 'label.Guides', icon: 'book', menu: false, nav: false },
];

export const STUDIO_HOME = { key: 'explore', href: '/app', labelKey: 'label.Explore' };

const SECTION_ORDER = ['tools', 'assets'];

function openDestinations(flags) {
  return STUDIO_DESTINATIONS.filter((d) => !d.flag || flags[d.flag]);
}

function shownDestinations(flags) {
  return openDestinations(flags).filter((d) => d.nav !== false);
}

function localise(d, t) {
  const label = d.labelKey.startsWith('label.') ? t.label(d.labelKey.slice(6)) : t(d.labelKey);
  return { ...d, label, ...(d.hintKey ? { hint: t(d.hintKey) } : {}) };
}

// Sidebar: the two groups, flag-gated and nav:false rows removed.
export function studioSidebarSections(t, flags) {
  return SECTION_ORDER.map((id) => ({
    id,
    label: t(`app.nav.side.${id}`),
    items: shownDestinations(flags).filter((d) => d.section === id).map((d) => localise(d, t)),
  }));
}

// Phone menu: Home first, then every destination that is not menu:false.
export function studioMenuItems(t, flags) {
  return [localise(STUDIO_HOME, t), ...shownDestinations(flags).filter((d) => d.menu !== false).map((d) => localise(d, t))];
}

// Every route the active lookup should know, including rows the menu omits.
export function studioActiveCandidates(flags) {
  return [STUDIO_HOME, ...openDestinations(flags)].filter((d) => d.key);
}
