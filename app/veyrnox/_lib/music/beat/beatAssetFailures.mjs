export function permanentAssetFailure(error) {
  return error.permanent === true || error.name === 'EncodingError'
    || /This take was deleted|Unsupported audio|Unsupported sample rate|changed size|sound metadata|120 MB|300 MB|Audio duration is unknown/.test(error.message || '');
}
export function clearTransientFailures(states, key) {
  for (const [id, state] of states) {
    if ((key === undefined || key === id) && state.status === 'missing' && !state.permanent) states.delete(id);
  }
}
