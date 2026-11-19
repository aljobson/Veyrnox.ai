// Reader support and writer admission deliberately advance in separate releases.
export const BEAT_WRITE_VERSION = 4;
export const BEAT_READ_VERSION = 5;
// Editor state for a record this app can read but not write (shown as the update-required message).
export const BEAT_UPDATE_REQUIRED = 'update_required';
export const unsupportedBeatVersion = version => Number.isSafeInteger(version) && version > BEAT_READ_VERSION;
export function beatCompatibilityError(code) {
  return Object.assign(new Error(code), { code, status: 409 });
}
export function assertBeatWritable(doc) {
  if (unsupportedBeatVersion(doc?.version)) throw beatCompatibilityError('unsupported_version');
  if (doc?.version > BEAT_WRITE_VERSION) throw beatCompatibilityError('v5_write_disabled');
}
