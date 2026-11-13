// First-run personal answers (ADR-0339): role and destination, beside the goal (_lib/firstGoal.js). One fixed word each
// (or "skipped"); never free text, never in a URL. They only order and pre-fill screens: no price, model or access.
// Keep in step with apps/mobile/src/lib/firstProfile.ts and lib/firstGoal.js.
export const FIRST_PROFILE_VERSION = 1;
export const FIRST_PROFILE_SLOT = `veyrnox.firstProfile.v${FIRST_PROFILE_VERSION}`;

export const FIRST_ROLES = ['creator', 'business', 'pro', 'hobbyist', 'beginner'];
export const FIRST_DESTINATIONS = ['tiktok', 'reels', 'youtube', 'private'];

const ROLE_IDS = new Set([...FIRST_ROLES, 'skipped']);
const DESTINATION_IDS = new Set([...FIRST_DESTINATIONS, 'skipped']);
const role = (value) => (typeof value === 'string' && ROLE_IDS.has(value) ? value : null);
const destination = (value) => (typeof value === 'string' && DESTINATION_IDS.has(value) ? value : null);

export function serializeFirstProfile({ role: r = null, destination: d = null } = {}) {
  if ((r !== null && !ROLE_IDS.has(r)) || (d !== null && !DESTINATION_IDS.has(d))) throw new Error('unknown first-run answer');
  return JSON.stringify({ version: FIRST_PROFILE_VERSION, role: r, destination: d });
}

// Anything unreadable, from another version, or off the list reads as "never chose".
export function parseFirstProfile(raw) {
  const none = { role: null, destination: null };
  if (!raw) return none;
  try {
    const value = JSON.parse(raw);
    if (!value || Array.isArray(value) || value.version !== FIRST_PROFILE_VERSION) return none;
    return { role: role(value.role), destination: destination(value.destination) };
  } catch {
    return none;
  }
}

// What the server said (GET /api/v1/first-goal). A server that sends no role yet means "none"; an unlisted word is unreadable.
export function readRemoteFirstProfile(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { kind: 'unavailable' };
  const r = body.role ?? null;
  const d = body.destination ?? null;
  if ((r !== null && role(r) === null) || (d !== null && destination(d) === null)) return { kind: 'unavailable' };
  return { kind: 'profile', role: r, destination: d };
}

// Asked only of someone with no goal and no role on record, so an account that answered before is never asked again.
export const needsFirstRun = ({ goal = null, role: r = null } = {}) => goal === null && r === null;

export const hasRealAnswer = (profile) => !!profile && [profile.goal, profile.role, profile.destination].some((word) => word && word !== 'skipped' && word !== 'unsure');

// Home start options in the order this person should see them. Goal puts its own area first; no answer keeps the default.
const START_ORDER = {
  creator: ['create', 'smart-cut', 'film', 'chat'],
  business: ['create', 'film', 'chat', 'smart-cut'],
  pro: ['film', 'create', 'smart-cut', 'chat'],
  hobbyist: ['create', 'film', 'chat', 'smart-cut'],
  beginner: ['create', 'chat', 'film', 'smart-cut'],
};
const DEFAULT_STARTS = ['create', 'chat', 'film', 'smart-cut'];
const GOAL_START = { video: 'film', edit: 'smart-cut' };

export function orderStarts(r, goal) {
  const base = START_ORDER[r] ?? DEFAULT_STARTS;
  const first = GOAL_START[goal];
  return first ? [first, ...base.filter((key) => key !== first)] : [...base];
}

// "work" examples (product, ad and brand ideas) for creator, business and pro; the everyday ones for everyone else.
export const exampleSetFor = (r) => (r === 'creator' || r === 'business' || r === 'pro' ? 'work' : 'everyday');

// The starting aspect ratio on Create. "Just for me" and skipped change nothing, so the form keeps its own default.
const ASPECT = { tiktok: '9:16', reels: '9:16', youtube: '16:9' };
export const defaultAspectFor = (d) => (typeof d === 'string' && Object.hasOwn(ASPECT, d) ? ASPECT[d] : null);
