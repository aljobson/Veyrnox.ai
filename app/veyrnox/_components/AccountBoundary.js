'use client';

import { Fragment, useSyncExternalStore } from 'react';
import { getStoredUserId, onSessionChange } from '../../lib/authClient';

const accountId = () => getStoredUserId() || 'signed-out';
const serverAccount = () => 'signed-out';

// Remount account pages and pollers when identity changes, including another
// tab signing out. Their old effects clean up and private React state is lost.
export function AccountBoundary({ children }) {
  const account = useSyncExternalStore(onSessionChange, accountId, serverAccount);
  return <Fragment key={account}>{children}</Fragment>;
}
