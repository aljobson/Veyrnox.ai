// The server flag for the public Oddlings gallery, apart from the gallery's
// data so the shared layout can read it without loading the cast.
// Production leaves the var out (absence is off; wrangler.jsonc explains the
// binding budget) and staging names it "true".
export const ODDLINGS_PUBLIC_FLAG = 'ODDLINGS_PUBLIC_ENABLED';

/** Only the exact string "true" opens the gallery. Read per request, never cached. */
export function oddlingsPublicEnabled(env = process.env) {
  return Boolean(env) && typeof env === 'object' && env[ODDLINGS_PUBLIC_FLAG] === 'true';
}
