'use client';
import { useState } from 'react';

// Says `label` once, to screen readers only, each time `busy` goes from true to
// false. For streamed text: a live region around the growing text is read again
// with every chunk. The label is kept as it was at that moment, so later
// re-renders with a different label say nothing.
export function BusyDoneStatus({ busy, label }) {
  const [wasBusy, setWasBusy] = useState(busy);
  const [said, setSaid] = useState('');
  if (busy !== wasBusy) {
    setWasBusy(busy);
    setSaid(busy ? '' : label);
  }
  return <p role="status" className="sr-only">{said}</p>;
}
