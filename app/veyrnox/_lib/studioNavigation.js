// Shared destinations for the signed-in site's menu and the account menu.
export const STUDIO_LINKS = [
  { href: '/app/film-studio', label: 'Film Studio' },
  { href: '/app/library', label: 'Library' },
  { href: '/app/editor', label: 'Video editor' },
  { href: '/app/projects', label: 'Projects' },
];

export function activeStudioDestination(pathname, items) {
  const path = (pathname || '').replace(/^\/veyrnox/, '') || '/';
  if (path === '/app') return 'explore';
  return items
    .filter((item) => item.href !== '/app' && (path === item.href || path.startsWith(`${item.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0]?.key ?? null;
}
