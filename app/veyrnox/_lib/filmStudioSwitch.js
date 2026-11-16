// Film Studio is hidden from the website (ADR-0344). The pages' code, saved films, Library masters and the
// /api/v1/film-studio routes stay; nothing links to the workspace and /app/film-studio answers 404.
// To bring it back: set this to true (and the app's twin apps/mobile/src/lib/filmStudioSwitch.ts), then restore the pinned tests.
export const FILM_STUDIO_ENABLED = false;
