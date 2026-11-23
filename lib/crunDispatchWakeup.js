const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Crun deliberately uses the minute backstop: the existing queue worker has no Crun key. */
export function publishCrunDispatchWakeup(jobId) {
    if (!UUID_RE.test(String(jobId || ''))) throw new Error('invalid committed job');
    return false;
}
