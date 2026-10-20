// English strings for calendar. Add keys here; keep their original wording and placeholders.
export default {
    // App-only: Publish calendar and best time (read-only).
    'calendar.title': 'Calendar',
    'calendar.prev': 'Previous week',
    'calendar.next': 'Next week',
    'calendar.thisWeek': 'Back to this week',
    'calendar.none': 'Nothing scheduled this week.',
    'calendar.noText': '(no text)',
    'calendar.more': 'There are more posts this week than can be shown here. See the rest on veyrnox.ai.',
    'calendar.err.plan': 'The calendar needs a Publish Plan on this brand.',
    'calendar.err.notOpen': 'The calendar is not open yet.',
    'calendar.err.range': 'That week could not be shown. Go back to this week.',
    'calendar.err.brand': 'That brand is not available to you. Choose another in Brand.',
    'calendar.err.rate': 'Too many requests. Wait a moment and try again.',
    'calendar.err.network': 'No connection. Try again.',
    // App-only: Publish calendar month, analytics range and compare, locked states, draft approval (parity P5, ADR-0162).
    'calendar.week': 'Week',
    'calendar.month': 'Month',
    'calendar.prevMonth': 'Previous month',
    'calendar.nextMonth': 'Next month',
    'calendar.thisMonth': 'Back to this month',
    'calendar.noneMonth': 'Nothing scheduled this month.',
    'calendar.noneDay': 'Nothing scheduled on this day.',
    'calendar.postsOne': '{count} post',
    'calendar.postsMany': '{count} posts',
} as const;
