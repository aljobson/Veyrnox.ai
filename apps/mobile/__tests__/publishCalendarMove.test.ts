import { ApiError } from '../src/lib/api';
import { parseCalendar, dayKey } from '../src/lib/publishCalendar';
import { canMove, droppedAt, dropTarget, moveAttempt, moveOutcome, moveProblem, overlay, pendingDelays, serverHolds } from '../src/lib/publishCalendarMove';
const post = parseCalendar({ posts: [{ id: 'a', status: 'scheduled', can_reschedule: true, scheduled_at: new Date(2030, 0, 2, 12, 34).toISOString(), targets: [{ id: 't', network: 'twitter', publish_status: 'pending' }] }] }).posts[0];
const when = new Date(2030, 0, 5, 12, 34), attempt = moveAttempt(post, when);
test('day-only drop preserves local hours/minutes and rejects same day or invalid round trips', () => {
    expect(droppedAt(post, '2030-01-05')).toEqual(when);
    expect(droppedAt(post, dayKey(new Date(post.scheduledAt!)))).toBeNull();
    expect(droppedAt(post, '2030-02-30')).toBeNull();
    expect(droppedAt(post, 'bad')).toBeNull();
    // Without changing the process TZ, exercise the round-trip guard as a native DST normalization would.
    const hours = jest.spyOn(Date.prototype, 'getHours');
    hours.mockReturnValueOnce(2).mockReturnValueOnce(3).mockReturnValueOnce(2);
    expect(droppedAt(post, '2030-03-31')).toBeNull(); hours.mockRestore();
});
test('hit test includes top/left and excludes bottom/right', () => {
    const rects = [{ key: 'a', x: 10, y: 20, width: 30, height: 40 }];
    expect(dropTarget(10, 20, rects)).toBe('a'); expect(dropTarget(39, 59, rects)).toBe('a');
    expect(dropTarget(40, 20, rects)).toBeNull(); expect(dropTarget(10, 60, rects)).toBeNull();
});
test.each(['owner', 'manager', 'editor', 'reviewer', 'analyst', 'viewer', null] as const)('move gate: %s', role => {
    expect(canMove(post, role)).toBe(['owner', 'manager', 'editor'].includes(role!));
    expect(canMove({ ...post, canReschedule: false }, role)).toBe(false);
    expect(canMove({ ...post, targets: [{ ...post.targets[0], publishStatus: 'publishing' }] }, role)).toBe(false);
});
test('frozen CAS, future validation and bounded backoff', () => {
    expect(Object.isFrozen(attempt)).toBe(true);
    expect(attempt).toEqual({ postId: post.id, expectedAt: post.scheduledAt, scheduledAt: when.toISOString() });
    expect(moveProblem(when, new Date(+when - 60_000))).not.toBeNull();
    expect(moveProblem(when, new Date(+when - 60_001))).toBeNull();
    expect(pendingDelays).toEqual([2000, 4000, 8000, 16000]);
});
test.each([
    [new Error(), 'unknown'], [new ApiError(0, 'network'), 'unknown'], [new ApiError(0, 'network', { timedOut: true }), 'unknown'],
    ...[429, 400, 403, 404].map(status => [new ApiError(status, 'error'), 'refused'] as [ApiError, string]),
    [new ApiError(409, 'SCHEDULE_CHANGED'), 'changed'], [new ApiError(409, 'POST_STARTED'), 'refused'], [new ApiError(409, 'POST_BUSY'), 'refused'],
    [new ApiError(502, 'internal'), 'unknown'], [new ApiError(503, 'calendar_not_open'), 'refused'], [new ApiError(503, 'supabase_not_configured'), 'refused'], [new ApiError(503, 'service_unavailable'), 'unknown'],
])('classifies %s', (err, outcome) => expect(moveOutcome(err)).toBe(outcome));
test('server resolution is status-first and timestamp-format independent', () => {
    expect(serverHolds(null, attempt)).toBe('gone'); expect(serverHolds(post, attempt)).toBe('old');
    expect(serverHolds({ ...post, scheduledAt: when.toISOString().replace('Z', '+00:00') }, attempt)).toBe('new');
    expect(serverHolds({ ...post, scheduledAt: new Date(+when + 86400000).toISOString() }, attempt)).toBe('other');
    for (const status of ['published', 'failed']) expect(serverHolds({ ...post, status }, attempt)).toBe('started');
    expect(serverHolds({ ...post, targets: [{ ...post.targets[0], publishStatus: 'publishing' }] }, attempt)).toBe('started');
    for (const scheduledAt of [post.scheduledAt, attempt.scheduledAt]) expect(serverHolds({ ...post, status: 'canceled', scheduledAt }, attempt)).toBe('canceled');
    for (const status of ['draft', 'unknown']) expect(serverHolds({ ...post, status }, attempt)).toBe('unscheduled');
});
test('overlay changes only its own post and never mutates server rows', () => {
    const b = { ...post, id: 'b' }, rows = [post, b];
    const moves = new Map([['a', { attempt, phase: 'pending' as const }]]);
    const shown = overlay(rows, moves);
    expect(shown[0].scheduledAt).toBe(attempt.scheduledAt); expect(shown[1]).toBe(b); expect(post.scheduledAt).toBe(attempt.expectedAt);
    moves.clear(); expect(overlay(rows, moves)[0]).toBe(post);
});
