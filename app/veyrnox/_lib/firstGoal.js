// First-visit question on Create: "What do you want to make first?" (one question, skippable, asked once per browser).
// Slice 1 keeps the answer on this device only; it carries words-free state (a goal id), never a file or a key.
export const FIRST_GOAL_VERSION = 1;
export const FIRST_GOAL_SLOT = `veyrnox.firstGoal.v${FIRST_GOAL_VERSION}`;

export const FIRST_GOALS = [
  { id: 'image', label: 'Make an image' },
  { id: 'video', label: 'Make a video' },
  { id: 'audio', label: 'Make audio' },
  { id: 'edit', label: 'Edit something' },
  { id: 'publish', label: 'Publish something' },
  { id: 'unsure', label: 'Not sure yet' },
];

// "Not sure yet" shows one example for each of these, so a person with no idea still has something to tap.
export const FIRST_GOAL_EXAMPLES = ['image', 'video', 'audio'];

const GOAL_IDS = new Set([...FIRST_GOALS.map(({ id }) => id), 'skipped']);

// Where a goal leads: a Create model filter, or another area of the app. Unknown values fall back to all models.
export function firstGoalTarget(goal) {
  if (goal === 'image' || goal === 'video' || goal === 'audio') return { createGoal: goal, href: null };
  if (goal === 'edit') return { createGoal: null, href: '/app/editor' };
  if (goal === 'publish') return { createGoal: null, href: '/app/publish' };
  return { createGoal: 'all', href: null };
}

// The home start options are the first-goal answer, so Create never asks a second time. Film and Smart Cut name an area;
// Create and Chat do not, so they hold the lowest word ("skipped"), which any real goal later outranks.
// Keep in step with apps/mobile/src/lib/firstGoal.ts.
export const HOME_START_GOALS = { create: 'skipped', chat: 'skipped', film: 'video', 'smart-cut': 'edit' };
export const homeStartGoal = (key) => (Object.hasOwn(HOME_START_GOALS, key) ? HOME_START_GOALS[key] : null);

export function serializeFirstGoal(goal) {
  if (!GOAL_IDS.has(goal)) throw new Error('unknown first goal');
  return JSON.stringify({ version: FIRST_GOAL_VERSION, goal });
}

// Anything unreadable, from another version, or off the list reads as "never chose", so the person is simply asked again.
export function parseFirstGoal(raw) {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || Array.isArray(value) || value.version !== FIRST_GOAL_VERSION) return null;
    return GOAL_IDS.has(value.goal) ? { version: FIRST_GOAL_VERSION, goal: value.goal } : null;
  } catch {
    return null;
  }
}

// What the server said (GET /api/v1/first-goal). A listed word is the account's answer, null means it has none yet,
// and anything else is unreadable, which falls back to this device's own copy.
export function readRemoteFirstGoal(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !('goal' in body)) return { kind: 'unavailable' };
  if (body.goal === null) return { kind: 'none' };
  return typeof body.goal === 'string' && GOAL_IDS.has(body.goal) ? { kind: 'goal', goal: body.goal } : { kind: 'unavailable' };
}
