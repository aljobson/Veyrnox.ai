// English source catalog. Flat dotted keys, {slot} placeholders, `.one` / `.other` (and the other CLDR
// categories) for plurals. Every other language mirrors these keys; a missing key falls back to this file.
// Strings that exist on the public site (lib/i18n/messages) keep their wording; app-only strings are new keys
// and go to the localization process listed in the PR that adds them.
const en = {
    'net.offline': "You're offline. Showing what was saved.",
    'net.offlineAction': "You're offline. Reconnect to continue.",
    'cache.stale': 'Saved {age} ago',
    'cache.staleNow': 'Saved just now',
} as const;

export default en;
