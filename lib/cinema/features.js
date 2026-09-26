/** Server-side rollout controls. Browser storage never grants a capability. */
export const CINEMA_FEATURE_FLAGS = Object.freeze({
  creators: 'CREATOR_APPLICATIONS_ENABLED',
  content: 'CREATOR_CONTENT_ENABLED',
  profiles: 'SOCIAL_CINEMA_PROFILES_ENABLED',
  uploads: 'CREATOR_UPLOADS_ENABLED',
  monetisation: 'CREATOR_MONETISATION_ENABLED',
  subscriptions: 'CINEMA_SUBSCRIPTIONS_ENABLED',
  unlocks: 'CINEMA_UNLOCKS_ENABLED',
  publishing: 'CINEMA_PUBLISHING_ENABLED',
  viewing: 'CINEMA_VIEWING_ENABLED',
  voting: 'VOTING_ENABLED',
  comments: 'COMMENTS_ENABLED',
  ppv: 'PPV_ENABLED',
  premieres: 'PREMIERES_ENABLED',
  recommendations: 'AI_RECOMMENDATIONS_ENABLED',
});

/**
 * Only the exact string "true" enables a switch. Re-evaluate for each request:
 * callers must not cache a deployment's mutable rollout state globally.
 * @param {Record<string, string | undefined>} env
 */
export function cinemaFeatures(env) {
  const enabled = env.CINEMA_ENABLED === 'true';
  /** @param {keyof typeof CINEMA_FEATURE_FLAGS} name */
  const on = (name) => enabled && env[CINEMA_FEATURE_FLAGS[name]] === 'true';
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
    publishing: profiles && on('content') && on('publishing'),
    viewing: on('viewing'),
    monetisation: profiles && subscriptions && on('monetisation'),
    voting: profiles && on('voting'),
    comments: profiles && on('comments'),
    ppv: profiles && subscriptions && on('monetisation') && on('ppv'),
    premieres: profiles && on('uploads') && on('premieres'),
    recommendations: on('recommendations'),
  });
}
