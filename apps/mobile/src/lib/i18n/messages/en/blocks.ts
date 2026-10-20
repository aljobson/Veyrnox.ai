// English strings for blocks. Add keys here; keep their original wording and placeholders.
export default {

    // App-only: blocking Cinema members.
    'blocks.title': 'Blocked members',
    'blocks.intro': 'You do not see blocked members\' comments or titles in Cinema. They are not told. You can unblock them here at any time.',
    'blocks.none': 'You have not blocked anyone.',
    'blocks.cancel': 'Cancel',
    'blocks.block': 'Block',
    'blocks.unblock': 'Unblock',
    'blocks.blockMember': 'Block {name}',
    'blocks.blockTitle': 'Block {name}?',
    'blocks.blockBody': 'You will no longer see their comments or titles in Cinema. They are not told. To report them to us instead, use Report.',
    'blocks.unblockTitle': 'Unblock {name}',
    'blocks.unblockBody': 'You will see their comments and titles in Cinema again.',
    'blocks.unblocked': '{name} is unblocked.',
    'blocks.err.self': 'You cannot block yourself.',
    'blocks.err.notFound': 'That member could not be found.',
    'blocks.err.limit': 'You have reached the limit of blocked members. Unblock someone first.',
    'blocks.err.account': 'Your account could not be found. Sign in again.',
    'blocks.err.rate': 'Too many requests. Wait a moment and try again.',
    'blocks.err.notOpen': 'Cinema is not open yet.',
    'blocks.err.later': 'Blocking is not available right now. Try again later.',
    'blocks.err.network': 'No connection. Nothing changed. Try again.',
} as const;
