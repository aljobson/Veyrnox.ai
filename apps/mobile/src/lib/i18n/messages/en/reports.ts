// English strings for reports. Add keys here; keep their original wording and placeholders.
export default {
    // App-only: Publish reports, PDF and slide download and share (parity P5, ADR-0166).
    'reports.title': 'Reports',
    'reports.intro': 'Saved reports. Download one as a PDF or slides and share it. Reports are made and edited on veyrnox.ai for now.',
    'reports.none': 'No saved reports yet.',
    'reports.range': 'Last {days} days',
    'reports.compared': 'compared with the period before',
    'reports.lastSent': 'Last sent {when}',
    'reports.cadence.weekly': 'sent weekly',
    'reports.cadence.monthly': 'sent monthly',
    'reports.format.pdf': 'PDF',
    'reports.format.pptx': 'Slides',
    'reports.shareAs': 'Share {name} as {format}',
    'reports.exportsOff': 'Downloading reports is not open yet.',
    'reports.err.network': 'No connection. Try again.',
    'reports.err.plan': 'Reports need the Publish Plan on this brand.',
    'reports.err.notOpen': 'Reports are not open yet.',
    'reports.err.noData': 'There are no numbers for this report yet.',
    'reports.err.rate': 'Too many requests. Wait a moment and try again.',
    'reports.err.invalid': 'The file did not come through correctly. Try again.',
    'reports.err.share': 'Could not open sharing. Try again.',
    'reports.err.later': 'Reports are not available right now. Try again later.',
} as const;
