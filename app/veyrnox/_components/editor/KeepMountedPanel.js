'use client';
import { useState } from 'react';
// Once opened, preserve the component instance, polling and pending request identity.
export function KeepMountedPanel({ active, children }) {
    const [visited, setVisited] = useState(active);
    if (active && !visited) setVisited(true);
    return <div hidden={!active}>{active || visited ? children : null}</div>;
}
