'use client';
import { useEffect, useState } from 'react';

export function useVideoEnhancePreview() {
    const [enabled, setEnabled] = useState(false);
    useEffect(() => {
        const read = () => {
            try { setEnabled(process.env.NODE_ENV === 'development' && localStorage.getItem('veyrnox_video_enhance') === '1'); }
            catch { setEnabled(false); }
        };
        read(); window.addEventListener('storage', read);
        return () => window.removeEventListener('storage', read);
    }, []);
    return enabled;
}
