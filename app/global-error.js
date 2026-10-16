'use client';

import ErrorRecovery from '../components/ErrorRecovery';

export default function GlobalError({ retry }) {
  return (
    <html lang="en">
      <head><title>Page unavailable — Veyrnox.ai</title></head>
      <body style={{ margin: 0 }}>
        <ErrorRecovery retry={retry} />
      </body>
    </html>
  );
}
