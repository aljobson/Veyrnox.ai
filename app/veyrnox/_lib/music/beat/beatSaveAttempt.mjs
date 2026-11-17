// A retry is the same operation only when both the payload and rendered bytes match.
export function mixdownSaveAttempt(previous, payload, sha256, createKey = () => crypto.randomUUID()) {
  return previous?.payload === payload && previous.sha256 === sha256
    ? previous : { payload, sha256, key: createKey() };
}
