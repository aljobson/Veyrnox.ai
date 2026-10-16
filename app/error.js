'use client';

import ErrorRecovery from '../components/ErrorRecovery';

export default function Error({ retry }) {
  return <ErrorRecovery retry={retry} />;
}
