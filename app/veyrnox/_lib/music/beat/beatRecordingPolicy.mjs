export const RECORDING_LOCK_REASON = 'Stop recording to edit';
export const recordingEditAllowed = (recording, options = {}) => !recording || options.liveMix === true || options.recordingCommit === true;
