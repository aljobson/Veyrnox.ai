// Film Studio is hidden from the app (ADR-0344). The code, saved films and Library masters stay; nothing links to it.
// To bring it back: set this to true (and the web twin app/veyrnox/_lib/filmStudioSwitch.js), then restore the pinned tests.
export const FILM_STUDIO_ENABLED = false;

// A link that would open a Film Studio screen: our scheme (ai.veyrnox.app://film), a bare path (/film/workspace) or the
// website's own address (https://veyrnox.ai/app/film-studio). Incoming links like these land on Home instead.
export const isFilmStudioLink = (path: string): boolean => {
    if (FILM_STUDIO_ENABLED) return false;
    if (/^https:\/\/(?:www\.)?veyrnox\.ai\/app\/film-studio(?:[/?#]|$)/i.test(path)) return true;
    return /^film(?:-studio)?(?:[/?#]|$)/i.test(path.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^\/+/, ''));
};
