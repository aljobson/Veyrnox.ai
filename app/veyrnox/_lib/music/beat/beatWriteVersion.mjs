let enabled = false, generation = 0;
const listeners = new Set();
export const getBeatWriteVersion = () => enabled ? 5 : 4;
export const capabilityGeneration = () => generation;
export const subscribeBeatWrites = listener => { listeners.add(listener); return () => listeners.delete(listener); };
// Entry points call this from layout effects, never from render.
export function configureBeatWrites(value) {
  apply(value === true);
}
// An authoritative server refusal revokes writes for the mounted page immediately.
export function refuseBeatWrites() { apply(false); }
function apply(next) {
  if (next === enabled) return;
  enabled = next; generation++;
  for (const listener of listeners) listener();
}
export function assertBeatGeneration(captured) {
  if (captured !== generation) throw Object.assign(new Error('capability_changed'), { code: 'capability_changed', status: 409 });
}
