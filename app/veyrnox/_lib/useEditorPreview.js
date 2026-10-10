'use client';
import { useEffect, useState } from 'react';

// Delivery gate only (like the projects preview): the server flag EDITOR_TIMELINE_ENABLED decides whether the route exists at all,
// and this per-browser switch decides who sees it while it is staged. Nothing here is authorization; the editor has no server API.
export function useEditorPreview() {
    const [enabled, setEnabled] = useState(false);
    useEffect(() => {
        const read = () => {
            try { setEnabled(localStorage.getItem('veyrnox_editor_timeline') === '1'); }
            catch { setEnabled(false); }
        };
        read();
        window.addEventListener('storage', read);
        return () => window.removeEventListener('storage', read);
    }, []);
    return enabled;
}
