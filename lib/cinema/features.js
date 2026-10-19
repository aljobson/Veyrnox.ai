/** Server-side rollout controls. Browser storage never grants a capability. */
export const CINEMA_FEATURE_FLAGS = Object.freeze({
  creators: 'CREATOR_APPLICATIONS_ENABLED',
  content: 'CREATOR_CONTENT_ENABLED',
  profiles: 'SOCIAL_CINEMA_PROFILES_ENABLED',
  uploads: 'CREATOR_UPLOADS_ENABLED',
  monetisation: 'CREATOR_MONETISATION_ENABLED',
  subscriptions: 'CINEMA_SUBSCRIPTIONS_ENABLED',
  unlocks: 'CINEMA_UNLOCKS_ENABLED',
  freeCeiling: 'CINEMA_FREE_CEILING_ENABLED',
  publishing: 'CINEMA_PUBLISHING_ENABLED',
  viewing: 'CINEMA_VIEWING_ENABLED',
  voting: 'VOTING_ENABLED',
  audience: 'CINEMA_AUDIENCE_ENABLED',
  rankings: 'CINEMA_RANKINGS_ENABLED',
  retention: 'CINEMA_RETENTION_ENABLED',
  creatorAnalytics: 'CINEMA_CREATOR_ANALYTICS_ENABLED',
  comments: 'COMMENTS_ENABLED',
  storyPolls: 'STORY_POLLS_ENABLED',
  ppv: 'PPV_ENABLED',
  premieres: 'PREMIERES_ENABLED',
  recommendations: 'AI_RECOMMENDATIONS_ENABLED',
});

const JSON_KEYS = Object.freeze(Object.keys(CINEMA_FEATURE_FLAGS));
const MAX_RUNTIME_FLAGS_CHARS = 2048;

/**
 * The switches kept in the one CINEMA_RUNTIME_FLAGS binding (a JSON object of
 * "true"/"false" strings keyed by CINEMA_FEATURE_FLAGS names), for the same
 * reason EDITOR_RUNTIME_FLAGS and PUBLISH_RUNTIME_FLAGS exist: each separate
 * var costs a Worker binding. Anything malformed, oversize or unknown turns
 * the whole object off, never partly on. CINEMA_ENABLED stays its own var.
 * @param {Record<string, string | undefined>} env
 * @returns {Record<string, string>}
 */
function runtimeFlags(env) {
  const raw = env.CINEMA_RUNTIME_FLAGS;
  if (typeof raw !== 'string' || raw.length > MAX_RUNTIME_FLAGS_CHARS) return {};
  try {
    const flags = JSON.parse(raw);
    if (!flags || typeof flags !== 'object' || Array.isArray(flags)) return {};
    for (const key of Object.keys(flags)) {
      if (!JSON_KEYS.includes(key) || (flags[key] !== 'true' && flags[key] !== 'false')) return {};
    }
    return flags;
  } catch { return {}; }
}

/**
 * Only the exact string "true" enables a switch. A separate var that is set
 * (to anything) is the rollback override and beats CINEMA_RUNTIME_FLAGS. Re-evaluate for each request:
 * callers must not cache a deployment's mutable rollout state globally.
 * @param {Record<string, string | undefined>} env
 */
export function cinemaFeatures(env) {
  const enabled = env.CINEMA_ENABLED === 'true';
  /** @param {keyof typeof CINEMA_FEATURE_FLAGS} name */
  const packed = runtimeFlags(env);
  const on = (name) => {
    if (!enabled) return false;
    const separate = env[CINEMA_FEATURE_FLAGS[name]];
    return separate !== undefined ? separate === 'true' : packed[name] === 'true';
  };
  const profiles = on('profiles');
  const subscriptions = on('subscriptions');
  return Object.freeze({
    enabled,
    profiles,
    creators: profiles && on('creators'),
    content: profiles && on('content'),
    uploads: profiles && on('uploads'),
    subscriptions,
    unlocks: profiles && on('unlocks'),
    freeCeiling: on('freeCeiling'),
    publishing: profiles && on('content') && on('publishing'),
    viewing: on('viewing'),
    monetisation: profiles && subscriptions && on('monetisation'),
    voting: profiles && on('voting'),
    audience: profiles && on('viewing') && on('audience'),
    rankings: profiles && on('viewing') && on('voting') && on('rankings'),
    retention: profiles && on('viewing') && on('retention'),
    creatorAnalytics: profiles && on('content') && on('viewing') && on('audience') && on('creatorAnalytics'),
    comments: profiles && on('comments'),
    storyPolls: profiles && on('storyPolls'),
    ppv: profiles && subscriptions && on('monetisation') && on('ppv'),
    premieres: profiles && on('uploads') && on('premieres'),
    recommendations: on('recommendations'),
  });
}
