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

const RUNTIME_FLAGS_MAX_LENGTH = 2048;

/**
 * CINEMA_RUNTIME_FLAGS is one JSON object variable carrying many switches in a single
 * Worker text binding (ADR-0145), like EDITOR_RUNTIME_FLAGS. Keys are the names in
 * CINEMA_FEATURE_FLAGS, values the strings "true" or "false". Anything malformed (not
 * an object, unknown key, non-string value, too long) turns the whole group off.
 * @param {Record<string, string | undefined>} env
 * @returns {Record<string, string>}
 */
function runtimeFlags(env) {
  const raw = env.CINEMA_RUNTIME_FLAGS;
  if (typeof raw !== 'string' || raw.length > RUNTIME_FLAGS_MAX_LENGTH) return {};
  try {
    const flags = JSON.parse(raw);
    if (!flags || typeof flags !== 'object' || Array.isArray(flags)) return {};
    const valid = Object.keys(flags).every((key) => Object.hasOwn(CINEMA_FEATURE_FLAGS, key) && (flags[key] === 'true' || flags[key] === 'false'));
    return valid ? flags : {};
  } catch { return {}; }
}

/**
 * Only the exact string "true" enables a switch. An individual CINEMA_* / CREATOR_* var,
 * when set to any value, wins over CINEMA_RUNTIME_FLAGS, so it stays a rollback override. Re-evaluate for each request:
 * callers must not cache a deployment's mutable rollout state globally.
 * @param {Record<string, string | undefined>} env
 */
export function cinemaFeatures(env) {
  const enabled = env.CINEMA_ENABLED === 'true';
  /** @param {keyof typeof CINEMA_FEATURE_FLAGS} name */
  const grouped = runtimeFlags(env);
  const on = (name) => {
    if (!enabled) return false;
    const individual = env[CINEMA_FEATURE_FLAGS[name]];
    return (individual !== undefined ? individual : grouped[name]) === 'true';
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
