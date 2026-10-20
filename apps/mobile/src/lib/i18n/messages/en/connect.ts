// English strings for connect. Add keys here; keep their original wording and placeholders.
export default {
    // App-only: connect a social account.
    'connect.title': 'Connect an account',
    'connect.intro': 'Connect a social account to Publish. You sign in on the network\'s own page; the app never sees your password.',
    'connect.button': 'Connect',
    'connect.action': 'Connect {network}',
    'connect.done': '{name} is connected.',
    'connect.cancelled': 'Nothing was connected.',
    'connect.remove': 'To remove an account, open Connected accounts and choose Disconnect.',
    'connect.own': 'New accounts are added to your own brand, whichever brand is chosen.',
    'connect.err.link': 'The sign-in page could not be opened safely. Nothing was connected.',
    'connect.err.return': 'The sign-in did not finish correctly. Nothing was connected. Try again.',
    'connect.err.provider': 'The network could not complete the sign-in. Nothing was connected. Try again later.',
    'connect.err.limit': 'You have reached your account limit on this plan.',
    'connect.err.noChannel': 'That Google account has no YouTube channel to connect.',
    'connect.err.unavailable': 'That network is not available yet.',
    'connect.err.state': 'That sign-in expired. Try again.',
    'connect.err.failed': 'The network refused the connection. Try again later.',
    'connect.err.later': 'Connecting is not available right now. Try again later.',
    'connect.err.rate': 'Too many requests. Wait a moment and try again.',
    'connect.err.network': 'No connection. Try again.',
} as const;
